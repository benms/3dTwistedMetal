import type { Obstacle, Vec2 } from './types';

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
export const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** First contact fraction along a finite segment, including starts inside. */
export function segmentCircle(a: Vec2, b: Vec2, c: Vec2, r: number): number | null {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    ox = a.x - c.x,
    oz = a.z - c.z;
  const cc = ox * ox + oz * oz - r * r;
  if (cc <= 0) return 0;
  const aa = dx * dx + dz * dz;
  if (aa < 1e-10) return null;
  const bb = 2 * (ox * dx + oz * dz),
    disc = bb * bb - 4 * aa * cc;
  if (disc < 0) return null;
  const t = (-bb - Math.sqrt(disc)) / (2 * aa);
  return t >= 0 && t <= 1 ? t : null;
}

export function segmentBox(a: Vec2, b: Vec2, box: Obstacle, padding = 0): number | null {
  let lo = 0,
    hi = 1;
  for (const axis of ['x', 'z'] as const) {
    const half = (axis === 'x' ? box.w : box.d) / 2 + padding;
    const min = box[axis] - half,
      max = box[axis] + half,
      delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-9) {
      if (a[axis] < min || a[axis] > max) return null;
    } else {
      const t1 = (min - a[axis]) / delta,
        t2 = (max - a[axis]) / delta;
      lo = Math.max(lo, Math.min(t1, t2));
      hi = Math.min(hi, Math.max(t1, t2));
      if (lo > hi) return null;
    }
  }
  return lo;
}

export function clearLine(a: Vec2, b: Vec2, obstacles: Obstacle[], padding = 0): boolean {
  return !obstacles.some(o => segmentBox(a, b, o, padding) !== null);
}

/** Outward normal and penetration, including centers inside a rectangle. */
export function circleBox(
  p: Vec2,
  radius: number,
  box: Obstacle,
): { x: number; z: number; depth: number } | null {
  const hx = box.w / 2,
    hz = box.d / 2;
  const dx = p.x - clamp(p.x, box.x - hx, box.x + hx);
  const dz = p.z - clamp(p.z, box.z - hz, box.z + hz);
  const d = Math.hypot(dx, dz);
  if (d >= radius) return null;
  if (d > 1e-8) return { x: dx / d, z: dz / d, depth: radius - d };
  const ex = hx - Math.abs(p.x - box.x),
    ez = hz - Math.abs(p.z - box.z);
  return ex < ez
    ? { x: p.x < box.x ? -1 : 1, z: 0, depth: ex + radius }
    : { x: 0, z: p.z < box.z ? -1 : 1, depth: ez + radius };
}
