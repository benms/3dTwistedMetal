import {
  ARENA,
  KILL_CREDIT_WINDOW,
  MAX_ROCKETS,
  OBSTACLES,
  SPAWNS,
  STEP,
  VEHICLES,
  VEHICLE_IDS,
  WEAPONS,
  emptyInput,
} from './config';
import {
  angleDelta,
  circleBox,
  clamp,
  clearLine,
  distance,
  lerp,
  segmentBox,
  segmentCircle,
} from './math';
import { botInput, buildWaypoints } from './navigation';
import type {
  DriverSpec,
  InputState,
  MatchOutcome,
  Projectile,
  Vec2,
  Vehicle,
  VehicleId,
  World,
} from './types';

export const BOT_NAMES = ['RUST REAPER', 'DEADWEIGHT', 'JUNK DOG', 'ROAD HAZARD', 'BLACKOUT'];
export const MAX_DRIVERS = SPAWNS.length;

/** Humans take the first seats, then `bots` bots (by default, enough to fill the grid). */
export function fillDrivers(
  humans: readonly { name: string; vehicle: VehicleId }[],
  bots = MAX_DRIVERS,
): DriverSpec[] {
  const drivers: DriverSpec[] = humans
    .slice(0, MAX_DRIVERS)
    .map(h => ({ name: h.name, vehicle: h.vehicle, human: true }));
  const seats = Math.min(MAX_DRIVERS, drivers.length + Math.max(0, Math.floor(bots)));
  for (let seat = drivers.length; seat < seats; seat++)
    drivers.push({
      name: BOT_NAMES[(seat - 1 + BOT_NAMES.length) % BOT_NAMES.length],
      vehicle: VEHICLE_IDS[(seat - 1 + VEHICLE_IDS.length) % VEHICLE_IDS.length],
      human: false,
    });
  return drivers;
}

/** The offline match: you in seat 0 against five bots, or alone for practice (`bots` 0). */
export function createWorld(
  selected: VehicleId = 'hellion',
  seed = 18471,
  bots = BOT_NAMES.length,
): World {
  return createMatch(fillDrivers([{ name: 'YOU', vehicle: selected }], bots), seed);
}

/** A lone car with no opponents: free roam that only ends if the yard wrecks you. */
export function isPractice(world: Pick<World, 'vehicles'>): boolean {
  return world.vehicles.length === 1;
}

export function createMatch(drivers: readonly DriverSpec[], seed = 18471): World {
  const vehicles: Vehicle[] = drivers.slice(0, MAX_DRIVERS).map((driver, id) => {
    const p = SPAWNS[id];
    const def = VEHICLES[driver.vehicle];
    return {
      ...p,
      id,
      name: driver.name,
      human: driver.human,
      def,
      prevX: p.x,
      prevZ: p.z,
      prevHeading: p.heading,
      vx: 0,
      vz: 0,
      hp: def.health,
      boost: 100,
      rockets: 4,
      gunCooldown: 0,
      rocketCooldown: 0,
      impactCooldown: 0,
      kills: 0,
      dead: false,
      eliminatedAt: null,
      lastAttacker: -1,
      lastAttackedAt: -100,
      lastHit: -100,
      control: emptyInput(),
      bot: {
        target: -1,
        path: [],
        repath: 0,
        stuck: 0,
        reverse: 0,
        lastX: p.x,
        lastZ: p.z,
        dodge: id % 2 ? 1 : -1,
      },
    };
  });
  return {
    phase: 'selection',
    winner: null,
    time: 0,
    seed,
    vehicles,
    obstacles: OBSTACLES.map(o => ({ ...o })),
    nodes: buildWaypoints(OBSTACLES),
    events: [],
    projectiles: Array.from({ length: 192 }, (): Projectile => ({
      active: false,
      kind: 'bullet',
      owner: -1,
      x: 0,
      z: 0,
      prevX: 0,
      prevZ: 0,
      heading: 0,
      target: -1,
      life: 0,
    })),
    pickups: [
      { x: -65, z: 0, kind: 'repair', cooldown: 0 },
      { x: 65, z: 0, kind: 'repair', cooldown: 0 },
      { x: 0, z: -20, kind: 'repair', cooldown: 0 },
      { x: 0, z: 20, kind: 'ammo', cooldown: 0 },
      { x: -40, z: 60, kind: 'ammo', cooldown: 0 },
      { x: 40, z: -60, kind: 'ammo', cooldown: 0 },
    ],
    barrels: [
      [-18, -25],
      [-18, -28],
      [18, 26],
      [20, 28],
      [-41, 28],
      [42, -29],
      [-33, -57],
      [34, 57],
      [3, 4],
      [-3, -4],
    ].map(([x, z]) => ({ x, z, alive: true })),
  };
}

function random(world: World): number {
  let s = world.seed | 0;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  world.seed = s;
  return (s >>> 0) / 4294967296;
}

export function damage(world: World, car: Vehicle, amount: number, owner = -1): void {
  if (car.dead || amount <= 0) return;
  car.hp = Math.max(0, car.hp - amount);
  car.lastHit = world.time;
  if (owner >= 0 && owner !== car.id) {
    car.lastAttacker = owner;
    car.lastAttackedAt = world.time;
  }
  if (car.hp > 0) return;
  car.dead = true;
  car.eliminatedAt = world.time;
  car.vx = 0;
  car.vz = 0;
  // Walls, barrels and self-damage finish a car on behalf of its recent attacker only.
  const credited = world.time - car.lastAttackedAt <= KILL_CREDIT_WINDOW;
  const killer = credited ? world.vehicles.find(v => v.id === car.lastAttacker) : undefined;
  if (killer) killer.kills++;
  world.events.push({ type: 'explosion', x: car.x, z: car.z, power: 2.8, owner });
  world.events.push({
    type: 'kill',
    x: car.x,
    z: car.z,
    power: 1,
    owner: killer?.id,
    text: `${killer?.name ?? 'THE YARD'} wrecked ${car.name}`,
  });
}

export function explode(
  world: World,
  at: Vec2,
  radius: number,
  amount: number,
  owner: number,
): void {
  world.events.push({ type: 'explosion', ...at, power: radius / 6, owner });
  for (const car of world.vehicles) {
    const d = distance(car, at);
    if (!car.dead && d < radius + car.def.radius && clearLine(at, car, world.obstacles)) {
      damage(
        world,
        car,
        amount * (1 - clamp(d - car.def.radius, 0, radius) / radius) * (car.id === owner ? 0.5 : 1),
        owner,
      );
    }
  }
  for (const barrel of world.barrels) {
    if (barrel.alive && distance(at, barrel) < radius && clearLine(at, barrel, world.obstacles)) {
      barrel.alive = false;
      explode(world, barrel, 9, 32, owner);
    }
  }
}

/** Pure driving physics: no collisions, damage or events, so clients can predict with it. */
export function integrateVehicle(car: Vehicle, input: InputState, dt: number): void {
  const speed = car.vx * Math.sin(car.heading) + car.vz * Math.cos(car.heading);
  const steering =
    (car.def.handling * clamp(Math.abs(speed) / 8, 0, 1)) / (1 + Math.abs(speed) / 65);
  car.heading -= input.steer * steering * Math.sign(speed) * dt * (input.brake ? 1.35 : 1);
  const fx = Math.sin(car.heading),
    fz = Math.cos(car.heading);
  let forward = car.vx * fx + car.vz * fz;
  let side = car.vx * fz - car.vz * fx;
  const boosting = input.boost && input.throttle > 0 && car.boost > 0;
  car.boost = clamp(car.boost + (boosting ? -31 : input.boost ? 0 : 15) * dt, 0, 100);
  forward += input.throttle * car.def.acceleration * (boosting ? 1.7 : 1) * dt;
  forward *= Math.exp(-(input.throttle ? 0.28 : 1.15) * dt);
  side *= Math.exp(-(input.brake ? 1.5 : 7.5) * dt);
  if (input.brake) forward *= Math.exp(-1.8 * dt);
  forward = clamp(forward, -car.def.speed * 0.4, car.def.speed * (boosting ? 1.45 : 1));
  car.vx = fx * forward + fz * side;
  car.vz = fz * forward - fx * side;
  car.x += car.vx * dt;
  car.z += car.vz * dt;
}

export function moveVehicle(world: World, car: Vehicle, input: InputState, dt: number): void {
  integrateVehicle(car, input, dt);
  resolveArenaCollision(world, car);
  for (const barrel of world.barrels)
    if (barrel.alive && distance(car, barrel) < car.def.radius + 0.7) {
      barrel.alive = false;
      explode(world, barrel, 9, 32, car.id);
    }
}

/** Push a car out of cover and the fence; prediction passes applyImpact=false to skip damage. */
export function resolveArenaCollision(world: World, car: Vehicle, applyImpact = true): void {
  for (let pass = 0; pass < 2; pass++)
    for (const obstacle of world.obstacles) {
      const hit = circleBox(car, car.def.radius, obstacle);
      if (!hit) continue;
      car.x += hit.x * (hit.depth + 0.001);
      car.z += hit.z * (hit.depth + 0.001);
      const inward = car.vx * hit.x + car.vz * hit.z;
      if (inward < 0) {
        car.vx -= hit.x * inward * 1.15;
        car.vz -= hit.z * inward * 1.15;
        if (applyImpact) impact(world, car, -inward * 0.33, -1);
      }
    }
  const edge = ARENA - car.def.radius;
  for (const axis of ['x', 'z'] as const) {
    if (Math.abs(car[axis]) > edge) {
      const velocity = axis === 'x' ? 'vx' : 'vz';
      if (applyImpact) impact(world, car, Math.abs(car[velocity]) * 0.3, -1);
      car[axis] = clamp(car[axis], -edge, edge);
      car[velocity] *= -0.2;
    }
  }
}

function impact(world: World, car: Vehicle, amount: number, owner: number): void {
  if (amount > 2.5 && car.impactCooldown <= 0) {
    damage(world, car, amount, owner);
    car.impactCooldown = 0.55;
    world.events.push({ type: 'hit', x: car.x, z: car.z, power: amount / 5 });
  }
}

export function collideVehicles(world: World): void {
  for (let i = 0; i < world.vehicles.length; i++)
    for (let j = i + 1; j < world.vehicles.length; j++) {
      const a = world.vehicles[i],
        b = world.vehicles[j];
      if (a.dead || b.dead) continue;
      const d = distance(a, b),
        reach = a.def.radius + b.def.radius;
      if (d >= reach) continue;
      const nx = d < 1e-8 ? 1 : (b.x - a.x) / d,
        nz = d < 1e-8 ? 0 : (b.z - a.z) / d;
      const invA = 1 / a.def.mass,
        invB = 1 / b.def.mass,
        sum = invA + invB;
      a.x -= (nx * (reach - d) * invA) / sum;
      a.z -= (nz * (reach - d) * invA) / sum;
      b.x += (nx * (reach - d) * invB) / sum;
      b.z += (nz * (reach - d) * invB) / sum;
      const approach = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (approach <= 0) continue;
      const impulse = (approach * 1.35) / sum;
      a.vx -= nx * impulse * invA;
      a.vz -= nz * impulse * invA;
      b.vx += nx * impulse * invB;
      b.vz += nz * impulse * invB;
      impact(world, a, (approach * 0.55 * b.def.mass) / a.def.mass, b.id);
      impact(world, b, (approach * 0.55 * a.def.mass) / b.def.mass, a.id);
    }
}

/** Nearest visible rival inside the rocket lock cone; shared by firing and the HUD lock indicator. */
export function rocketTarget(
  world: World,
  car: Vehicle,
  heading = car.heading,
): Vehicle | undefined {
  let target: Vehicle | undefined,
    best: number = WEAPONS.rocket.lockRange;
  for (const candidate of world.vehicles) {
    if (candidate.dead || candidate.id === car.id) continue;
    const d = distance(car, candidate);
    if (
      d < best &&
      Math.abs(angleDelta(heading, Math.atan2(candidate.x - car.x, candidate.z - car.z))) <
        WEAPONS.rocket.lockCone &&
      clearLine(car, candidate, world.obstacles)
    ) {
      target = candidate;
      best = d;
    }
  }
  return target;
}

export function fireWeapon(world: World, car: Vehicle, kind: 'bullet' | 'rocket'): boolean {
  if (
    car.dead ||
    (kind === 'bullet' ? car.gunCooldown > 0 : car.rocketCooldown > 0 || car.rockets <= 0)
  )
    return false;
  const p = world.projectiles.find(p => !p.active);
  if (!p) return false;
  const heading = car.heading + (kind === 'bullet' ? (random(world) - 0.5) * 0.035 : 0);
  const offset = car.def.radius + 0.65;
  const target = kind === 'rocket' ? (rocketTarget(world, car, heading)?.id ?? -1) : -1;
  Object.assign(p, {
    active: true,
    kind,
    owner: car.id,
    heading,
    target,
    life: WEAPONS[kind].life,
    x: car.x + Math.sin(heading) * offset,
    z: car.z + Math.cos(heading) * offset,
  });
  p.prevX = p.x;
  p.prevZ = p.z;
  // A muzzle must never fire through cover when a bumper is touching it.
  if (!clearLine(car, p, world.obstacles)) {
    p.x = car.x;
    p.z = car.z;
    p.prevX = p.x;
    p.prevZ = p.z;
  }
  if (kind === 'bullet') car.gunCooldown = WEAPONS.bullet.cooldown;
  else {
    car.rockets--;
    car.rocketCooldown = WEAPONS.rocket.cooldown;
  }
  world.events.push({
    type: kind === 'bullet' ? 'gun' : 'rocket',
    x: p.x,
    z: p.z,
    power: 1,
    owner: car.id,
  });
  return true;
}

export function updateProjectiles(world: World, dt: number): void {
  for (const p of world.projectiles) {
    if (!p.active) continue;
    const weapon = WEAPONS[p.kind];
    const target = world.vehicles.find(v => v.id === p.target && !v.dead);
    if (p.kind === 'rocket' && target) {
      const desired = Math.atan2(target.x - p.x, target.z - p.z);
      p.heading += clamp(
        angleDelta(p.heading, desired),
        -WEAPONS.rocket.turn * dt,
        WEAPONS.rocket.turn * dt,
      );
    }
    const from = { x: p.x, z: p.z };
    const to = {
      x: p.x + Math.sin(p.heading) * weapon.speed * dt,
      z: p.z + Math.cos(p.heading) * weapon.speed * dt,
    };
    p.prevX = p.x;
    p.prevZ = p.z;
    let first = Infinity,
      hitCar: Vehicle | undefined,
      hitBarrel = -1;
    for (const obstacle of world.obstacles) {
      const t = segmentBox(from, to, obstacle, weapon.radius);
      if (t !== null && t < first) {
        first = t;
        hitCar = undefined;
        hitBarrel = -1;
      }
    }
    for (const car of world.vehicles) {
      if (car.dead || car.id === p.owner) continue;
      const t = segmentCircle(from, to, car, car.def.radius + weapon.radius);
      if (t !== null && t < first) {
        first = t;
        hitCar = car;
        hitBarrel = -1;
      }
    }
    world.barrels.forEach((b, i) => {
      if (!b.alive) return;
      const t = segmentCircle(from, to, b, 0.8 + weapon.radius);
      if (t !== null && t < first) {
        first = t;
        hitCar = undefined;
        hitBarrel = i;
      }
    });
    p.x = lerp(from.x, to.x, Math.min(first, 1));
    p.z = lerp(from.z, to.z, Math.min(first, 1));
    p.life -= dt;
    if (first !== Infinity) {
      p.active = false;
      if (hitBarrel >= 0) {
        const barrel = world.barrels[hitBarrel];
        barrel.alive = false;
        explode(world, barrel, 9, 32, p.owner);
      }
      if (p.kind === 'rocket') {
        // Back away from a wall by a small amount so blast occlusion is well defined.
        const at = { x: p.x - Math.sin(p.heading) * 0.08, z: p.z - Math.cos(p.heading) * 0.08 };
        explode(world, at, WEAPONS.rocket.blast, weapon.damage, p.owner);
      } else {
        if (hitCar) damage(world, hitCar, weapon.damage, p.owner);
        world.events.push({ type: 'hit', x: p.x, z: p.z, power: hitCar ? 0.7 : 0.35 });
      }
    } else if (p.life <= 0 || Math.abs(p.x) > ARENA || Math.abs(p.z) > ARENA) p.active = false;
  }
}

export function updatePickups(world: World, dt: number): void {
  for (const pickup of world.pickups) {
    pickup.cooldown = Math.max(0, pickup.cooldown - dt);
    if (pickup.cooldown > 0) continue;
    for (const car of world.vehicles) {
      if (car.dead || distance(car, pickup) > car.def.radius + 1.5) continue;
      if (pickup.kind === 'repair' && car.hp < car.def.health)
        car.hp = Math.min(car.def.health, car.hp + 45);
      else if (pickup.kind === 'ammo' && car.rockets < MAX_ROCKETS)
        car.rockets = Math.min(MAX_ROCKETS, car.rockets + 3);
      else continue;
      pickup.cooldown = 16;
      world.events.push({
        type: 'pickup',
        x: pickup.x,
        z: pickup.z,
        power: 1,
        owner: car.id,
        text: pickup.kind === 'repair' ? 'ARMOR REPAIRED' : '+3 ROCKETS',
      });
      break;
    }
  }
}

/**
 * Advance one fixed step. Human cars read `inputs[id]`, falling back to their previous
 * controls when no fresh input arrived; bot cars drive themselves.
 */
export function stepWorld(
  world: World,
  inputs: Readonly<Record<number, InputState>>,
  dt = STEP,
  simulateBots = true,
): void {
  world.events.length = 0;
  if (world.phase !== 'playing') return;
  world.time += dt;
  for (const car of world.vehicles) {
    car.prevX = car.x;
    car.prevZ = car.z;
    car.prevHeading = car.heading;
    if (car.dead) continue;
    car.gunCooldown = Math.max(0, car.gunCooldown - dt);
    car.rocketCooldown = Math.max(0, car.rocketCooldown - dt);
    car.impactCooldown = Math.max(0, car.impactCooldown - dt);
    car.control = car.human
      ? (inputs[car.id] ?? car.control)
      : simulateBots
        ? botInput(world, car, dt)
        : emptyInput();
    moveVehicle(world, car, car.control, dt);
  }
  collideVehicles(world);
  // Pair separation can push a car into nearby cover; constrain the final positions.
  for (const car of world.vehicles) if (!car.dead) resolveArenaCollision(world, car);
  for (const car of world.vehicles)
    if (!car.dead) {
      if (car.control.gun) fireWeapon(world, car, 'bullet');
      if (car.control.rocket) fireWeapon(world, car, 'rocket');
    }
  updateProjectiles(world, dt);
  updatePickups(world, dt);
  // The round ends once no human is left driving or a single car remains; practice has
  // no rivals to outlast, so it only ends with your own wreck.
  const alive = world.vehicles.filter(v => !v.dead);
  const lastStanding = !isPractice(world) && alive.length <= 1;
  if (lastStanding || !alive.some(v => v.human)) {
    world.phase = 'over';
    world.winner = alive.length === 1 ? alive[0].id : null;
  }
}

/** Victory only for the sole survivor; a simultaneous final wreck is a defeat for everyone. */
export function outcomeFor(world: World, localId: number): MatchOutcome | null {
  if (world.phase !== 'over') return null;
  return world.winner === localId ? 'victory' : 'defeat';
}

/** The car the chase camera follows: yours, or once wrecked, the leading survivor. */
export function cameraTarget(world: World, localId: number): Vehicle {
  const own = world.vehicles[localId];
  if (own && !own.dead) return own;
  // Prefer another human, then whoever has the most wrecks.
  const score = (car: Vehicle) => (car.human ? 1000 : 0) + car.kills;
  let best: Vehicle | undefined;
  for (const car of world.vehicles)
    if (!car.dead && (!best || score(car) > score(best))) best = car;
  return best ?? own ?? world.vehicles[0];
}

export class FixedStepper {
  private accumulator = 0;
  reset(): void {
    this.accumulator = 0;
  }
  advance(elapsed: number, step: () => void): number {
    this.accumulator += clamp(elapsed, 0, 0.1);
    let count = 0;
    while (this.accumulator + 1e-10 >= STEP && count < 6) {
      step();
      this.accumulator = Math.max(0, this.accumulator - STEP);
      count++;
    }
    return clamp(this.accumulator / STEP, 0, 1);
  }
}
