import { describe, expect, it } from 'vitest';
import { STEP, emptyInput } from '../src/config';
import { buildScoreboard } from '../src/scoreboard';
import {
  BOT_NAMES,
  cameraTarget,
  createMatch,
  createWorld,
  damage,
  fillDrivers,
  integrateVehicle,
  isPractice,
  moveVehicle,
  outcomeFor,
  stepWorld,
} from '../src/simulation';
import type { World } from '../src/types';

function duel(): World {
  const world = createMatch(
    fillDrivers([
      { name: 'ALPHA', vehicle: 'viper' },
      { name: 'BRAVO', vehicle: 'goliath' },
    ]),
  );
  world.phase = 'playing';
  return world;
}

describe('driver seating', () => {
  it('seats humans first and fills the grid with the offline bot roster', () => {
    const drivers = fillDrivers([
      { name: 'ALPHA', vehicle: 'viper' },
      { name: 'BRAVO', vehicle: 'goliath' },
    ]);
    expect(drivers).toHaveLength(6);
    expect(drivers.slice(0, 2).every(d => d.human)).toBe(true);
    expect(drivers.slice(2).every(d => !d.human)).toBe(true);
    expect(drivers.map(d => d.name).slice(2)).toEqual(BOT_NAMES.slice(1));
  });
  it('keeps the offline world identical to the solo roster', () => {
    const world = createWorld('viper');
    expect(world.vehicles.map(v => v.name)).toEqual(['YOU', ...BOT_NAMES]);
    expect(world.vehicles.map(v => v.human)).toEqual([true, false, false, false, false, false]);
    expect(world.vehicles[0].def.id).toBe('viper');
    expect(world.winner).toBeNull();
  });
  it('seats only the requested number of bots', () => {
    const drivers = fillDrivers([{ name: 'ALPHA', vehicle: 'viper' }], 2);
    expect(drivers.map(d => d.human)).toEqual([true, false, false]);
    expect(fillDrivers([{ name: 'ALPHA', vehicle: 'viper' }], 0)).toHaveLength(1);
  });
  it('plays a two-car duel to a winner', () => {
    const world = createMatch(fillDrivers([{ name: 'ALPHA', vehicle: 'viper' }], 1));
    world.phase = 'playing';
    expect(world.vehicles).toHaveLength(2);
    damage(world, world.vehicles[1], 1000, 0);
    stepWorld(world, {}, STEP, false);
    expect(world.winner).toBe(0);
    expect(outcomeFor(world, 0)).toBe('victory');
  });
  it('keeps a practice run going until the yard wrecks you', () => {
    const world = createWorld('viper', 18471, 0);
    world.phase = 'playing';
    expect(world.vehicles.map(v => v.name)).toEqual(['YOU']);
    expect(isPractice(world)).toBe(true);
    for (let i = 0; i < 600; i++) stepWorld(world, { 0: { ...emptyInput(), throttle: 1 } });
    expect(world.phase).toBe('playing');
    damage(world, world.vehicles[0], 1000);
    stepWorld(world, {});
    expect(world.phase).toBe('over');
    expect(world.winner).toBeNull();
    expect(outcomeFor(world, 0)).toBe('defeat');
  });
  it('caps a match at six drivers', () => {
    const humans = Array.from({ length: 8 }, (_, i) => ({
      name: `P${i}`,
      vehicle: 'hellion' as const,
    }));
    expect(fillDrivers(humans)).toHaveLength(6);
  });
});

describe('multiple human drivers', () => {
  it('applies each human input to its own car only', () => {
    const world = duel();
    const startA = { x: world.vehicles[0].x, z: world.vehicles[0].z };
    const startB = { x: world.vehicles[1].x, z: world.vehicles[1].z };
    for (let i = 0; i < 30; i++)
      stepWorld(world, { 0: { ...emptyInput(), throttle: 1 }, 1: emptyInput() }, STEP, false);
    expect(
      Math.hypot(world.vehicles[0].x - startA.x, world.vehicles[0].z - startA.z),
    ).toBeGreaterThan(1);
    expect(world.vehicles[1].x).toBeCloseTo(startB.x, 6);
    expect(world.vehicles[1].z).toBeCloseTo(startB.z, 6);
  });
  it('repeats the previous controls when a human input is missing this tick', () => {
    const world = duel();
    stepWorld(world, { 1: { ...emptyInput(), throttle: 1 } }, STEP, false);
    const speed = Math.hypot(world.vehicles[1].vx, world.vehicles[1].vz);
    stepWorld(world, {}, STEP, false);
    expect(world.vehicles[1].control.throttle).toBe(1);
    expect(Math.hypot(world.vehicles[1].vx, world.vehicles[1].vz)).toBeGreaterThan(speed);
  });
  it('keeps the match running while another human is still alive', () => {
    const world = duel();
    damage(world, world.vehicles[0], 1000, 1);
    stepWorld(world, {}, STEP, false);
    expect(world.phase).toBe('playing');
    expect(outcomeFor(world, 0)).toBeNull();
  });
  it('ends when the last human is wrecked even if bots remain', () => {
    const world = duel();
    damage(world, world.vehicles[0], 1000);
    damage(world, world.vehicles[1], 1000);
    stepWorld(world, {}, STEP, false);
    expect(world.phase).toBe('over');
    expect(world.winner).toBeNull();
    expect(outcomeFor(world, 0)).toBe('defeat');
    expect(outcomeFor(world, 1)).toBe('defeat');
  });
  it('names the last car standing as the winner for every viewer', () => {
    const world = duel();
    world.vehicles.forEach(v => v.id !== 1 && damage(world, v, 1000, 1));
    stepWorld(world, {}, STEP, false);
    expect(world.winner).toBe(1);
    expect(outcomeFor(world, 1)).toBe('victory');
    expect(outcomeFor(world, 0)).toBe('defeat');
  });
  it('highlights the viewer in the scoreboard', () => {
    const rows = buildScoreboard(duel(), 1);
    expect(rows.filter(r => r.isPlayer).map(r => r.driverId)).toEqual([1]);
  });
  it('follows the leading human after your own car is wrecked', () => {
    const world = duel();
    world.vehicles[3].kills = 3;
    expect(cameraTarget(world, 0).id).toBe(0);
    damage(world, world.vehicles[0], 1000);
    expect(cameraTarget(world, 0).id).toBe(1);
    damage(world, world.vehicles[1], 1000);
    expect(cameraTarget(world, 0).id).toBe(3);
  });
});

describe('prediction physics', () => {
  it('matches moveVehicle exactly in open ground', () => {
    const world = duel();
    world.obstacles = [];
    world.barrels = [];
    const a = world.vehicles[0];
    const b = structuredClone(a);
    const input = { ...emptyInput(), throttle: 1, steer: 0.5, boost: true };
    for (let i = 0; i < 90; i++) {
      moveVehicle(world, a, input, STEP);
      integrateVehicle(b, input, STEP);
    }
    expect(b.x).toBe(a.x);
    expect(b.z).toBe(a.z);
    expect(b.heading).toBe(a.heading);
    expect(b.boost).toBe(a.boost);
  });
});
