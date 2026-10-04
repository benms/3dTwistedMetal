import { describe, expect, it } from 'vitest';
import { buildScoreboard } from '../src/scoreboard';
import { createWorld, damage } from '../src/simulation';

describe('end-of-match scoreboard', () => {
  it('lists all six drivers, their vehicles, and the player marker', () => {
    const world = createWorld('goliath');
    const rows = buildScoreboard(world);
    expect(rows).toHaveLength(6);
    expect(rows.map(row => row.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.filter(row => row.isPlayer)).toHaveLength(1);
    expect(rows.find(row => row.isPlayer)).toMatchObject({
      driverId: 0,
      driverName: 'YOU',
      vehicleName: 'GOLIATH',
      kills: 0,
      survivalSeconds: 0,
      alive: true,
    });
  });

  it('puts the last survivor first even if a wrecked rival has more kills', () => {
    const world = createWorld();
    world.time = 80;
    world.phase = 'over';
    world.vehicles.slice(1).forEach((car, index) => {
      car.dead = true;
      car.eliminatedAt = 20 + index * 10;
    });
    world.vehicles[1].kills = 4;
    world.vehicles[0].kills = 1;
    const rows = buildScoreboard(world);
    expect(rows[0]).toMatchObject({ driverId: 0, alive: true, kills: 1, survivalSeconds: 80 });
    expect(rows.slice(1).every(row => !row.alive)).toBe(true);
  });

  it('retains all surviving opponents when player elimination ends a round early', () => {
    const world = createWorld();
    world.time = 40;
    damage(world, world.vehicles[0], 1000, 1);
    world.phase = 'over';
    const rows = buildScoreboard(world);
    expect(rows.filter(row => row.alive)).toHaveLength(5);
    expect(rows[0]).toMatchObject({ driverId: 1, kills: 1, alive: true });
    expect(rows[5]).toMatchObject({
      driverId: 0,
      isPlayer: true,
      alive: false,
      survivalSeconds: 40,
    });
  });

  it('sorts by survival status, kills, survival time, and stable driver order', () => {
    const world = createWorld();
    world.time = 80;
    const results = [
      { dead: true, kills: 3, eliminatedAt: 20 },
      { dead: true, kills: 3, eliminatedAt: 50 },
      { dead: true, kills: 4, eliminatedAt: 15 },
      { dead: false, kills: 0, eliminatedAt: null },
      { dead: false, kills: 2, eliminatedAt: null },
      { dead: false, kills: 2, eliminatedAt: null },
    ];
    world.vehicles.forEach((car, index) => Object.assign(car, results[index]));
    expect(buildScoreboard(world).map(row => row.driverId)).toEqual([4, 5, 3, 2, 1, 0]);
  });

  it('records an elimination once and freezes that driver’s survival time', () => {
    const world = createWorld();
    world.time = 10;
    damage(world, world.vehicles[1], 1000, 0);
    expect(world.vehicles[1].eliminatedAt).toBe(10);
    world.time = 90;
    damage(world, world.vehicles[1], 1000, 2);
    expect(world.vehicles[1].eliminatedAt).toBe(10);
    expect(world.vehicles[0].kills).toBe(1);
    const rows = buildScoreboard(world);
    expect(rows.find(row => row.driverId === 1)?.survivalSeconds).toBe(10);
    expect(rows.find(row => row.driverId === 0)?.survivalSeconds).toBe(90);
  });

  it('does not stamp elimination time for nonfatal damage', () => {
    const world = createWorld();
    world.time = 5;
    damage(world, world.vehicles[1], 1, 0);
    world.time = 20;
    expect(world.vehicles[1].eliminatedAt).toBeNull();
    expect(buildScoreboard(world).find(row => row.driverId === 1)).toMatchObject({
      alive: true,
      survivalSeconds: 20,
    });
  });

  it('preserves an elimination at zero seconds', () => {
    const world = createWorld();
    damage(world, world.vehicles[5], 1000, 0);
    world.time = 30;
    expect(buildScoreboard(world).find(row => row.driverId === 5)?.survivalSeconds).toBe(0);
  });

  it('does not reorder or mutate the simulation when building standings', () => {
    const world = createWorld();
    world.vehicles.reverse();
    const before = JSON.stringify(world);
    const rows = buildScoreboard(world);
    expect(rows.map(row => row.driverId)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(JSON.stringify(world)).toBe(before);
    rows[0].driverName = 'Edited snapshot';
    expect(world.vehicles.find(car => car.id === 0)?.name).toBe('YOU');
  });

  it('starts replays without old eliminations, kills, or survival times', () => {
    const old = createWorld();
    old.time = 45;
    damage(old, old.vehicles[0], 1000, 1);
    const fresh = createWorld('viper');
    expect(fresh.vehicles.every(car => car.eliminatedAt === null)).toBe(true);
    const rows = buildScoreboard(fresh);
    expect(rows).toHaveLength(6);
    expect(rows.every(row => row.alive && row.kills === 0 && row.survivalSeconds === 0)).toBe(true);
    expect(rows.find(row => row.isPlayer)?.vehicleName).toBe('VIPER');
  });
});
