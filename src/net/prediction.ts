import { STEP, WEAPONS } from '../config';
import { angleDelta, lerp } from '../math';
import { integrateVehicle, resolveArenaCollision } from '../simulation';
import type { InputState, Vehicle, World } from '../types';
import type { VehicleSnap } from './protocol';

/** Unacknowledged inputs kept for replay: three seconds is far beyond any playable ping. */
const MAX_PENDING = 180;
/** Corrections larger than this (metres) snap instead of gliding, e.g. after a big shunt. */
export const SNAP_DISTANCE = 6;
/** Time constant (seconds) for gliding a visual correction away. */
const SMOOTHING = 0.1;

export interface Pose {
  x: number;
  z: number;
  heading: number;
}
const pose = (car: Pose): Pose => ({ x: car.x, z: car.z, heading: car.heading });

/**
 * Client-side prediction for your own car. Inputs apply locally at once; when the server
 * acknowledges inputs, its authoritative state is re-simulated forward through the rest,
 * and any difference is blended out over ~100 ms instead of popping.
 */
export class Predictor {
  readonly car: Vehicle;
  private pending: { seq: number; input: InputState }[] = [];
  private seq = 0;
  private prev: Pose;
  private error: Pose = { x: 0, z: 0, heading: 0 };

  constructor(car: Vehicle) {
    this.car = structuredClone(car);
    this.prev = pose(car);
  }

  /** Visual offset still being blended out; exposed for tests and debugging. */
  get correction(): Pose {
    return { ...this.error };
  }
  get unacknowledged(): number {
    return this.pending.length;
  }

  /** Apply one local input tick and return its sequence number for the server. */
  step(world: World, input: InputState, onFire?: (kind: 'gun' | 'rocket') => void): number {
    this.prev = pose(this.car);
    simulate(world, this.car, input, onFire);
    this.pending.push({ seq: ++this.seq, input });
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    return this.seq;
  }

  /** Rebase on the server's state for the last acknowledged input and replay the rest. */
  reconcile(world: World, server: VehicleSnap, ack: number): void {
    const car = this.car;
    const before = pose(car);
    car.x = server.x;
    car.z = server.z;
    car.heading = server.h;
    car.vx = server.vx;
    car.vz = server.vz;
    car.boost = server.b;
    car.rockets = server.r;
    car.gunCooldown = server.gc;
    car.rocketCooldown = server.rc;
    while (this.pending.length && this.pending[0].seq <= ack) this.pending.shift();
    for (const { input } of this.pending) simulate(world, car, input);
    const dx = before.x - car.x,
      dz = before.z - car.z,
      dh = angleDelta(car.heading, before.heading);
    // Shift the previous pose with the correction so interpolation stays continuous.
    this.prev.x -= dx;
    this.prev.z -= dz;
    this.prev.heading -= dh;
    this.error.x += dx;
    this.error.z += dz;
    this.error.heading += dh;
    if (Math.hypot(this.error.x, this.error.z) > SNAP_DISTANCE)
      this.error = { x: 0, z: 0, heading: 0 };
  }

  /** Pose to draw this frame, between the last two predicted ticks plus fading correction. */
  render(dt: number, alpha: number): Pose {
    const decay = Math.exp(-dt / SMOOTHING);
    this.error.x *= decay;
    this.error.z *= decay;
    this.error.heading *= decay;
    return {
      x: lerp(this.prev.x, this.car.x, alpha) + this.error.x,
      z: lerp(this.prev.z, this.car.z, alpha) + this.error.z,
      heading:
        this.prev.heading +
        angleDelta(this.prev.heading, this.car.heading) * alpha +
        this.error.heading,
    };
  }
}

/** The local share of `stepWorld` for one car: cooldowns, driving, cover and firing. */
function simulate(
  world: World,
  car: Vehicle,
  input: InputState,
  onFire?: (kind: 'gun' | 'rocket') => void,
): void {
  car.gunCooldown = Math.max(0, car.gunCooldown - STEP);
  car.rocketCooldown = Math.max(0, car.rocketCooldown - STEP);
  car.control = input;
  integrateVehicle(car, input, STEP);
  resolveArenaCollision(world, car, false);
  if (input.gun && car.gunCooldown <= 0) {
    car.gunCooldown = WEAPONS.bullet.cooldown;
    onFire?.('gun');
  }
  if (input.rocket && car.rocketCooldown <= 0 && car.rockets > 0) {
    car.rockets--;
    car.rocketCooldown = WEAPONS.rocket.cooldown;
    onFire?.('rocket');
  }
}
