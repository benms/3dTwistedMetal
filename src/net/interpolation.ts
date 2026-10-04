import { angleDelta, clamp, lerp } from '../math';
import type { GameEvent, World } from '../types';
import { applySnapshot, type ProjectileSnap, type SnapshotMessage } from './protocol';

/**
 * Buffers server snapshots and renders the world slightly in the past, so remote cars and
 * projectiles move smoothly between updates instead of stepping 20 times a second.
 */
export class SnapshotBuffer {
  private snaps: SnapshotMessage[] = [];
  /** Estimated server time minus local time, in seconds. */
  private offset: number | null = null;
  private dispatchedTick = -1;

  constructor(private delay = 0.1) {}

  reset(delay = this.delay): void {
    this.snaps = [];
    this.offset = null;
    this.dispatchedTick = -1;
    this.delay = delay;
  }

  get size(): number {
    return this.snaps.length;
  }

  push(snap: SnapshotMessage, now: number): void {
    const newest = this.snaps.at(-1);
    if (newest && snap.tick <= newest.tick) return;
    this.snaps.push(snap);
    // Early arrivals pull the clock forward quickly; late ones (jitter) only slowly.
    const sample = snap.time - now;
    if (this.offset === null || Math.abs(sample - this.offset) > 1) this.offset = sample;
    else this.offset += (sample - this.offset) * (sample > this.offset ? 0.25 : 0.03);
  }

  /** The server time currently being displayed. */
  renderTime(now: number): number | null {
    return this.offset === null ? null : now + this.offset - this.delay;
  }

  /**
   * Write the interpolated state at `now` into `world`, skipping the pose of `skipId`
   * (the locally predicted car), and deliver each snapshot's events once its time is shown.
   */
  sample(world: World, now: number, skipId: number, onEvent: (e: GameEvent) => void): boolean {
    const time = this.renderTime(now);
    if (time === null || !this.snaps.length) return false;
    for (const snap of this.snaps) {
      if (snap.time > time) break;
      if (snap.tick > this.dispatchedTick) {
        this.dispatchedTick = snap.tick;
        snap.e.forEach(onEvent);
      }
    }
    let i0 = 0;
    while (i0 + 1 < this.snaps.length && this.snaps[i0 + 1].time <= time) i0++;
    const s0 = this.snaps[i0];
    const s1 = this.snaps[i0 + 1] ?? s0;
    const t = s1 === s0 ? 0 : clamp((time - s0.time) / (s1.time - s0.time), 0, 1);
    applySnapshot(world, s0);
    if (s1 !== s0) {
      s0.v.forEach((a, id) => {
        const b = s1.v[id];
        const car = world.vehicles[id];
        if (!b || !car || id === skipId) return;
        car.x = car.prevX = lerp(a.x, b.x, t);
        car.z = car.prevZ = lerp(a.z, b.z, t);
        car.heading = car.prevHeading = a.h + angleDelta(a.h, b.h) * t;
      });
      const next = new Map<number, ProjectileSnap>(s1.p.map(p => [p[0], p]));
      for (const [index, kind, owner, x, z, heading] of s0.p) {
        const b = next.get(index);
        const p = world.projectiles[index];
        if (!b || !p || b[1] !== kind || b[2] !== owner) continue;
        p.x = p.prevX = lerp(x, b[3], t);
        p.z = p.prevZ = lerp(z, b[4], t);
        p.heading = heading + angleDelta(heading, b[5]) * t;
      }
    }
    // Everything before the current pair is displayed and dispatched; let it go.
    this.snaps.splice(0, i0);
    return true;
  }
}
