import { describe, expect, it } from 'vitest';
import { emptyInput } from '../src/config';
import {
  applySnapshot,
  encodeSnapshot,
  normalizeRoomCode,
  parseClientMessage,
  sanitizeInput,
  sanitizeName,
  withAck,
  type SnapshotMessage,
} from '../src/net/protocol';
import { createMatch, fillDrivers, fireWeapon, stepWorld } from '../src/simulation';

describe('input validation', () => {
  it('clamps axes, coerces flags and whitelists the weapon', () => {
    expect(
      sanitizeInput({
        throttle: 99,
        steer: -Infinity,
        brake: 'yes',
        boost: 1,
        gun: true,
        rocket: false,
        selectedWeapon: 'nuke',
      }),
    ).toEqual({ ...emptyInput(), throttle: 1, steer: 0, gun: true });
    expect(sanitizeInput({ throttle: NaN, steer: -0.4, selectedWeapon: 'rocket' })).toMatchObject({
      throttle: 0,
      steer: -0.4,
      selectedWeapon: 'rocket',
    });
    expect(sanitizeInput(null)).toEqual(emptyInput());
  });
  it('rejects malformed or unknown client frames', () => {
    for (const raw of [
      'not json',
      '[]',
      '{"t":"drop-tables"}',
      '{"t":"select","vehicle":"tank"}',
      '{"t":"input","seq":0}',
      '{"t":"input","seq":1.5}',
      '{"t":"join","v":1,"code":"AB","name":"x","vehicle":"viper"}',
    ])
      expect(parseClientMessage(raw)).toBeNull();
  });
  it('normalizes names and room codes', () => {
    expect(sanitizeName('  <script>alert(1)</script> ')).toBe('SCRIPTALERT1SCRI');
    expect(sanitizeName('')).toBe('DRIVER');
    expect(sanitizeName('  road   warrior ')).toBe('ROAD WARRIOR');
    expect(normalizeRoomCode(' ab-c d9 ')).toBe('ABCD');
    expect(
      parseClientMessage('{"t":"join","v":1,"code":"abcd","name":"x","vehicle":"viper"}'),
    ).toEqual({
      t: 'join',
      v: 1,
      code: 'ABCD',
      name: 'X',
      vehicle: 'viper',
    });
  });
});

describe('snapshots', () => {
  it('round-trips the world state a client needs to render', () => {
    const server = createMatch(fillDrivers([{ name: 'ALPHA', vehicle: 'viper' }]), 99);
    server.phase = 'playing';
    for (let i = 0; i < 90; i++) stepWorld(server, {});
    fireWeapon(server, server.vehicles[0], 'rocket');
    server.barrels[3].alive = false;
    server.pickups[2].cooldown = 7.5;
    server.vehicles[4].kills = 2;
    const json = withAck(JSON.stringify(encodeSnapshot(server, 90, server.events)), 41);
    const snap = JSON.parse(json) as SnapshotMessage;
    expect(snap.ack).toBe(41);
    expect(snap.tick).toBe(90);

    const client = createMatch(fillDrivers([{ name: 'ALPHA', vehicle: 'viper' }]), 1);
    applySnapshot(client, snap);
    expect(client.time).toBeCloseTo(server.time, 3);
    server.vehicles.forEach((car, i) => {
      const view = client.vehicles[i];
      expect(view.x).toBeCloseTo(car.x, 3);
      expect(view.z).toBeCloseTo(car.z, 3);
      expect(view.heading).toBeCloseTo(car.heading, 3);
      expect(view.hp).toBeCloseTo(car.hp, 3);
      expect(view.rockets).toBe(car.rockets);
      expect(view.kills).toBe(car.kills);
      expect(view.human).toBe(car.human);
      expect(view.control.selectedWeapon).toBe(car.control.selectedWeapon);
    });
    expect(client.projectiles.filter(p => p.active)).toHaveLength(
      server.projectiles.filter(p => p.active).length,
    );
    const rocket = server.projectiles.findIndex(p => p.active && p.kind === 'rocket');
    expect(client.projectiles[rocket]).toMatchObject({ active: true, kind: 'rocket', owner: 0 });
    expect(client.barrels.map(b => b.alive)).toEqual(server.barrels.map(b => b.alive));
    expect(client.pickups[2].cooldown).toBe(7.5);
  });
  it('reports a finished match and its winner', () => {
    const world = createMatch(fillDrivers([{ name: 'ALPHA', vehicle: 'viper' }]));
    world.phase = 'over';
    world.winner = 3;
    const snap = encodeSnapshot(world, 5, []);
    expect(snap).toMatchObject({ phase: 'over', winner: 3 });
  });
});
