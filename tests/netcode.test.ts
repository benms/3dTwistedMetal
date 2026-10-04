import { describe, expect, it } from 'vitest';
import { STEP, emptyInput } from '../src/config';
import { healthUrl, serverUrl } from '../src/net/endpoint';
import { SnapshotBuffer } from '../src/net/interpolation';
import { Predictor, SNAP_DISTANCE } from '../src/net/prediction';
import { encodeSnapshot, withAck, type SnapshotMessage } from '../src/net/protocol';
import { createMatch, fillDrivers, stepWorld } from '../src/simulation';
import type { GameEvent, InputState, World } from '../src/types';

const page = { protocol: 'https:', host: 'wreckyard.vercel.app' };

describe('server endpoint', () => {
  it('uses the configured server, normalizing scheme and path', () => {
    const url = (VITE_SERVER_URL: string) => serverUrl({ VITE_SERVER_URL, DEV: false }, page);
    expect(url('wss://wy.onrender.com/ws')).toBe('wss://wy.onrender.com/ws');
    expect(url('https://wy.onrender.com')).toBe('wss://wy.onrender.com/ws');
    expect(url('https://wy.onrender.com/')).toBe('wss://wy.onrender.com/ws');
    expect(url('http://localhost:8787')).toBe('ws://localhost:8787/ws');
    expect(url('ftp://nope')).toBeNull();
    expect(url('not a url')).toBeNull();
  });
  it('falls back to the dev proxy in development and disables online play otherwise', () => {
    expect(serverUrl({ DEV: true }, { protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/ws',
    );
    expect(serverUrl({ DEV: false, VITE_SERVER_URL: '  ' }, page)).toBeNull();
  });
  it('derives the health check URL from the socket URL', () => {
    expect(healthUrl('wss://wy.onrender.com/ws')).toBe('https://wy.onrender.com/healthz');
    expect(healthUrl('ws://localhost:5173/ws')).toBe('http://localhost:5173/healthz');
  });
});

function serverWorld(): World {
  const world = createMatch(fillDrivers([{ name: 'ALPHA', vehicle: 'hellion' }]));
  world.phase = 'playing';
  return world;
}
function snapshot(world: World, tick: number, ack = 0, events: GameEvent[] = []): SnapshotMessage {
  return JSON.parse(withAck(JSON.stringify(encodeSnapshot(world, tick, events)), ack));
}
const drive = (steer = 0): InputState => ({ ...emptyInput(), throttle: 1, steer });

describe('client-side prediction', () => {
  it('agrees with the server when both apply the same inputs', () => {
    const server = serverWorld();
    const client = createMatch(fillDrivers([{ name: 'ALPHA', vehicle: 'hellion' }]));
    const predictor = new Predictor(client.vehicles[0]);
    const inputs = Array.from({ length: 90 }, (_, i) => drive(i > 40 ? 0.6 : 0));
    // The client runs 6 ticks ahead of what the server has acknowledged.
    inputs.forEach(input => predictor.step(client, input));
    for (let i = 0; i < 84; i++) stepWorld(server, { 0: inputs[i] }, STEP, false);
    predictor.reconcile(client, snapshot(server, 84).v[0], 84);
    expect(predictor.unacknowledged).toBe(6);
    expect(Math.hypot(predictor.correction.x, predictor.correction.z)).toBeLessThan(0.01);
    expect(Math.abs(predictor.correction.heading)).toBeLessThan(0.001);
  });
  it('blends a server correction out smoothly instead of popping', () => {
    const client = createMatch(fillDrivers([{ name: 'ALPHA', vehicle: 'hellion' }]));
    const predictor = new Predictor(client.vehicles[0]);
    for (let i = 0; i < 30; i++) predictor.step(client, drive());
    const shown = predictor.render(0, 1);
    const server = serverWorld();
    for (let i = 0; i < 30; i++) stepWorld(server, { 0: drive() }, STEP, false);
    server.vehicles[0].x += 2; // e.g. a collision the client did not predict
    predictor.reconcile(client, snapshot(server, 30).v[0], 30);
    expect(predictor.car.x).toBeCloseTo(shown.x + 2, 2);
    const first = predictor.render(0, 1);
    expect(first.x).toBeCloseTo(shown.x, 6);
    let pose = first;
    for (let frame = 0; frame < 60; frame++) pose = predictor.render(1 / 60, 1);
    expect(pose.x).toBeCloseTo(predictor.car.x, 3);
  });
  it('snaps when the correction is too large to glide', () => {
    const client = createMatch(fillDrivers([{ name: 'ALPHA', vehicle: 'hellion' }]));
    const predictor = new Predictor(client.vehicles[0]);
    predictor.step(client, drive());
    const server = serverWorld();
    stepWorld(server, { 0: drive() }, STEP, false);
    server.vehicles[0].z -= SNAP_DISTANCE + 4;
    predictor.reconcile(client, snapshot(server, 1).v[0], 1);
    expect(predictor.correction).toEqual({ x: 0, z: 0, heading: 0 });
    expect(predictor.render(0, 1).z).toBeCloseTo(server.vehicles[0].z, 3);
  });
  it('reports local shots once per cooldown and respects rocket ammunition', () => {
    const client = createMatch(fillDrivers([{ name: 'ALPHA', vehicle: 'hellion' }]));
    const predictor = new Predictor(client.vehicles[0]);
    const fired: string[] = [];
    for (let i = 0; i < 60; i++)
      predictor.step(client, { ...emptyInput(), gun: true, rocket: true }, kind =>
        fired.push(kind),
      );
    expect(fired.filter(k => k === 'gun').length).toBeGreaterThanOrEqual(8);
    expect(fired.filter(k => k === 'gun').length).toBeLessThanOrEqual(9);
    expect(fired.filter(k => k === 'rocket')).toHaveLength(2);
    expect(predictor.car.rockets).toBe(2);
  });
});

describe('snapshot interpolation', () => {
  function stream() {
    const server = serverWorld();
    const snaps: SnapshotMessage[] = [];
    for (let tick = 1; tick <= 12; tick++) {
      stepWorld(server, { 0: drive() }, STEP);
      if (tick % 3 === 0)
        snaps.push(
          snapshot(server, tick, 0, tick === 6 ? [{ type: 'hit', x: 1, z: 2, power: 1 }] : []),
        );
    }
    return snaps;
  }

  it('renders between the two snapshots around the delayed render time', () => {
    const [a, b, c] = stream();
    const buffer = new SnapshotBuffer(0.1);
    const view = serverWorld();
    buffer.push(a, a.time);
    buffer.push(b, b.time);
    buffer.push(c, c.time);
    const now = (a.time + b.time) / 2 + 0.1; // displays halfway between a and b
    const events: GameEvent[] = [];
    expect(buffer.sample(view, now, -1, e => events.push(e))).toBe(true);
    const car = view.vehicles[3];
    expect(car.x).toBeCloseTo((a.v[3].x + b.v[3].x) / 2, 2);
    expect(car.z).toBeCloseTo((a.v[3].z + b.v[3].z) / 2, 2);
    expect(car.prevX).toBe(car.x);
    expect(events).toHaveLength(0);
    buffer.sample(view, now + 0.05, -1, e => events.push(e));
    buffer.sample(view, now + 0.06, -1, e => events.push(e));
    expect(events).toEqual([{ type: 'hit', x: 1, z: 2, power: 1 }]);
  });
  it('leaves the predicted car alone and ignores stale snapshots', () => {
    const [a, b, c] = stream();
    const buffer = new SnapshotBuffer(0.1);
    const view = serverWorld();
    buffer.push(b, b.time);
    buffer.push(a, b.time);
    expect(buffer.size).toBe(1);
    buffer.push(c, c.time);
    buffer.sample(view, c.time + 0.1 - 0.025, 0, () => {});
    expect(view.vehicles[0].x).toBeCloseTo(b.v[0].x, 6);
    expect(view.vehicles[0].z).toBeCloseTo(b.v[0].z, 6);
  });
  it('holds the newest state when the stream runs dry', () => {
    const snaps = stream();
    const buffer = new SnapshotBuffer(0.1);
    const view = serverWorld();
    for (const snap of snaps) buffer.push(snap, snap.time);
    const newest = snaps.at(-1)!;
    buffer.sample(view, newest.time + 5, -1, () => {});
    expect(view.time).toBe(newest.time);
    expect(view.vehicles[2].x).toBeCloseTo(newest.v[2].x, 6);
  });
});
