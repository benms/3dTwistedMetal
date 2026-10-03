import { describe, expect, it } from 'vitest';
import {
  KILL_CREDIT_WINDOW,
  MAX_ROCKETS,
  OBSTACLES,
  STEP,
  VEHICLES,
  VEHICLE_IDS,
  WEAPONS,
  emptyInput,
} from '../src/config';
import { circleBox, clearLine, distance, segmentBox, segmentCircle } from '../src/math';
import { botInput, buildWaypoints, findRoute } from '../src/navigation';
import {
  collideVehicles,
  createWorld,
  damage,
  explode,
  fireWeapon,
  FixedStepper,
  moveVehicle,
  rocketTarget,
  stepWorld,
  updatePickups,
  updateProjectiles,
} from '../src/simulation';
import type { Obstacle, Vehicle, World } from '../src/types';

const wall: Obstacle = { x: 0, z: 10, w: 20, d: 2, h: 5, kind: 'container', color: 0 };
function openWorld(): World {
  const world = createWorld();
  world.phase = 'playing';
  world.obstacles = [];
  world.barrels = [];
  world.pickups = [];
  world.vehicles.forEach((car, i) => {
    car.x = 60;
    car.z = -60 + i * 8;
    car.heading = 0;
    car.prevX = car.x;
    car.prevZ = car.z;
  });
  place(world.vehicles[0], 0, 0);
  return world;
}
function place(car: Vehicle, x: number, z: number, heading = 0): void {
  car.x = car.prevX = x;
  car.z = car.prevZ = z;
  car.heading = car.prevHeading = heading;
  car.vx = car.vz = 0;
}

describe('finite collision queries', () => {
  it('finds contact when a fast projectile crosses a complete car in one step', () => {
    expect(segmentCircle({ x: 0, z: 0 }, { x: 0, z: 30 }, { x: 0, z: 15 }, 2)).toBeCloseTo(13 / 30);
  });
  it('ignores targets beyond the segment and handles starts inside', () => {
    expect(segmentCircle({ x: 0, z: 0 }, { x: 0, z: 2 }, { x: 0, z: 10 }, 1)).toBeNull();
    expect(segmentCircle({ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }, 1)).toBe(0);
  });
  it('handles parallel rays and preserves cover occlusion', () => {
    expect(segmentBox({ x: 0, z: 0 }, { x: 0, z: 20 }, wall)).toBeCloseTo(0.45);
    expect(segmentBox({ x: 20, z: 0 }, { x: 20, z: 20 }, wall)).toBeNull();
    expect(clearLine({ x: 0, z: 0 }, { x: 0, z: 20 }, [wall])).toBe(false);
  });
  it('produces a finite escape normal for a car centered inside a box', () => {
    const hit = circleBox({ x: wall.x, z: wall.z }, 2, wall)!;
    expect(hit.depth).toBe(3);
    expect(Math.hypot(hit.x, hit.z)).toBe(1);
  });
});

describe('fixed-step driving', () => {
  it('travels the same distance at 30, 60 and 144 rendered frames per second', () => {
    const drive = (fps: number) => {
      const world = openWorld(),
        clock = new FixedStepper();
      const input = { ...emptyInput(), throttle: 1 };
      for (let i = 0; i < fps * 2; i++)
        clock.advance(1 / fps, () => stepWorld(world, input, STEP, false));
      return { z: world.vehicles[0].z, time: world.time };
    };
    const baseline = drive(60);
    for (const fps of [30, 144]) {
      expect(drive(fps).z).toBeCloseTo(baseline.z, 7);
      expect(drive(fps).time).toBeCloseTo(2, 7);
    }
  });
  it('bounds catch-up after a long suspended frame', () => {
    let steps = 0;
    new FixedStepper().advance(300, () => steps++);
    expect(steps).toBe(6);
  });
  it('gives each vehicle different armor and acceleration', () => {
    const speeds = VEHICLE_IDS.map(id => {
      const world = createWorld(id);
      world.obstacles = [];
      world.barrels = [];
      const car = world.vehicles[0];
      place(car, 0, 0);
      for (let i = 0; i < 60; i++) moveVehicle(world, car, { ...emptyInput(), throttle: 1 }, STEP);
      expect(car.hp).toBe(VEHICLES[id].health);
      return car.vz;
    });
    expect(speeds[0]).toBeGreaterThan(speeds[1]);
    expect(speeds[1]).toBeGreaterThan(speeds[2]);
  });
  it('drains boost while accelerating and recharges after release', () => {
    const world = openWorld(),
      car = world.vehicles[0];
    for (let i = 0; i < 30; i++)
      moveVehicle(world, car, { ...emptyInput(), throttle: 1, boost: true }, STEP);
    const drained = car.boost;
    expect(drained).toBeLessThan(100);
    for (let i = 0; i < 30; i++) moveVehicle(world, car, emptyInput(), STEP);
    expect(car.boost).toBeGreaterThan(drained);
    expect(car.boost).toBeLessThanOrEqual(100);
  });
  it('keeps a fast car outside a wall and applies impact damage', () => {
    const world = openWorld(),
      car = world.vehicles[0];
    world.obstacles = [wall];
    place(car, 0, 6);
    car.vz = 28;
    for (let i = 0; i < 10; i++) moveVehicle(world, car, { ...emptyInput(), throttle: 1 }, STEP);
    expect(car.z).toBeLessThanOrEqual(9 - car.def.radius + 0.001);
    expect(car.hp).toBeLessThan(car.def.health);
  });
  it('does not recharge an exhausted boost while the boost key remains held', () => {
    const world = openWorld(),
      car = world.vehicles[0];
    car.boost = 0;
    for (let i = 0; i < 60; i++)
      moveVehicle(world, car, { ...emptyInput(), throttle: 1, boost: true }, STEP);
    expect(car.boost).toBe(0);
  });
  it('preserves more lateral momentum during a handbrake drift', () => {
    const world = openWorld(),
      a = world.vehicles[0],
      b = world.vehicles[1];
    a.vx = b.vx = 10;
    a.vz = b.vz = 20;
    moveVehicle(world, a, { ...emptyInput(), brake: true }, STEP);
    moveVehicle(world, b, emptyInput(), STEP);
    expect(Math.abs(a.vx)).toBeGreaterThan(Math.abs(b.vx));
  });
  it('separates coincident vehicles without NaNs', () => {
    const world = openWorld(),
      [a, b] = world.vehicles;
    place(a, 0, 0);
    place(b, 0, 0);
    collideVehicles(world);
    expect(distance(a, b)).toBeCloseTo(a.def.radius + b.def.radius);
    expect(Number.isFinite(a.x + b.x)).toBe(true);
  });
  it('lets a heavy ram damage its opponent', () => {
    const world = openWorld(),
      [a, b] = world.vehicles;
    place(a, 0, 0);
    place(b, 0, 3);
    a.vz = 25;
    collideVehicles(world);
    expect(b.hp).toBeLessThan(b.def.health);
    expect(a.hp).toBeLessThan(a.def.health);
  });
});

describe('combat', () => {
  it('hits only the first vehicle along a bullet segment', () => {
    const world = openWorld(),
      [player, near, far] = world.vehicles;
    place(near, 0, 12);
    place(far, 0, 21);
    fireWeapon(world, player, 'bullet');
    updateProjectiles(world, 0.22);
    expect(near.hp).toBeLessThan(near.def.health);
    expect(far.hp).toBe(far.def.health);
  });
  it('stops a projectile at cover before an enemy behind it', () => {
    const world = openWorld(),
      [player, enemy] = world.vehicles;
    place(enemy, 0, 18);
    world.obstacles = [wall];
    fireWeapon(world, player, 'bullet');
    updateProjectiles(world, 0.2);
    expect(enemy.hp).toBe(enemy.def.health);
    expect(world.projectiles.filter(p => p.active)).toHaveLength(0);
  });
  it('cannot spawn a bullet through a wall at point-blank range', () => {
    const world = openWorld(),
      [player, enemy] = world.vehicles;
    world.obstacles = [{ ...wall, d: 0.2 }];
    place(player, 0, 7.7);
    place(enemy, 0, 16);
    fireWeapon(world, player, 'bullet');
    updateProjectiles(world, 0.2);
    expect(enemy.hp).toBe(enemy.def.health);
  });
  it('consumes rockets once and enforces cooldowns and ammunition limits', () => {
    const world = openWorld(),
      car = world.vehicles[0];
    car.rockets = 1;
    expect(fireWeapon(world, car, 'rocket')).toBe(true);
    expect(car.rockets).toBe(0);
    expect(fireWeapon(world, car, 'rocket')).toBe(false);
    car.rockets = 2;
    expect(fireWeapon(world, car, 'rocket')).toBe(false);
    car.rocketCooldown = 0;
    expect(fireWeapon(world, car, 'rocket')).toBe(true);
  });
  it('locks rockets only onto visible enemies in front', () => {
    const world = openWorld(),
      [player, enemy] = world.vehicles;
    place(enemy, 0, 30);
    fireWeapon(world, player, 'rocket');
    expect(world.projectiles[0].target).toBe(enemy.id);
    player.rocketCooldown = 0;
    world.obstacles = [wall];
    fireWeapon(world, player, 'rocket');
    expect(world.projectiles[1].target).toBe(-1);
  });
  it('continues flying when a homing target dies', () => {
    const world = openWorld(),
      [player, enemy] = world.vehicles;
    place(enemy, 0, 40);
    fireWeapon(world, player, 'rocket');
    enemy.dead = true;
    updateProjectiles(world, STEP);
    expect(world.projectiles[0].active).toBe(true);
    expect(Number.isFinite(world.projectiles[0].heading)).toBe(true);
  });
  it('credits a kill once, including AI against AI', () => {
    const world = openWorld(),
      killer = world.vehicles[1],
      victim = world.vehicles[2];
    damage(world, victim, 1000, killer.id);
    damage(world, victim, 1000, killer.id);
    expect(victim.hp).toBe(0);
    expect(killer.kills).toBe(1);
  });
  it('credits a wall wreck to a recent attacker but not a stale one', () => {
    const world = openWorld(),
      [, attacker, recent, stale] = world.vehicles;
    world.time = 10;
    damage(world, recent, 1, attacker.id);
    damage(world, stale, 1, attacker.id);
    world.time = 10 + KILL_CREDIT_WINDOW;
    damage(world, recent, 1000);
    world.time = 10 + KILL_CREDIT_WINDOW + 0.1;
    damage(world, stale, 1000);
    expect(attacker.kills).toBe(1);
    expect(world.events.filter(e => e.type === 'kill').map(e => e.text)).toEqual([
      `${attacker.name} wrecked ${recent.name}`,
      `THE YARD wrecked ${stale.name}`,
    ]);
  });
  it('shares rocket lock range and cone between firing and the HUD', () => {
    const world = openWorld(),
      [player, enemy] = world.vehicles;
    place(enemy, 0, WEAPONS.rocket.lockRange - 1);
    expect(rocketTarget(world, player)).toBe(enemy);
    place(enemy, 0, WEAPONS.rocket.lockRange + 1);
    expect(rocketTarget(world, player)).toBeUndefined();
    const offCone = WEAPONS.rocket.lockCone + 0.05;
    place(enemy, Math.sin(offCone) * 30, Math.cos(offCone) * 30);
    expect(rocketTarget(world, player)).toBeUndefined();
    fireWeapon(world, player, 'rocket');
    expect(world.projectiles[0].target).toBe(-1);
  });
  it('chains barrels once each without recursive loops', () => {
    const world = openWorld();
    world.barrels = [
      { x: 0, z: 10, alive: true },
      { x: 0, z: 12, alive: true },
    ];
    explode(world, { x: 0, z: 8 }, 6, 20, 0);
    expect(world.barrels.every(b => !b.alive)).toBe(true);
    expect(world.events.filter(e => e.type === 'explosion')).toHaveLength(3);
  });
  it('blocks blast damage behind solid cover', () => {
    const world = openWorld(),
      enemy = world.vehicles[1];
    place(enemy, 0, 18);
    world.obstacles = [wall];
    explode(world, { x: 0, z: 5 }, 25, 50, 0);
    expect(enemy.hp).toBe(enemy.def.health);
  });
  it('pools projectile capacity without consuming ammunition on allocation failure', () => {
    const world = openWorld();
    world.projectiles.forEach(p => (p.active = true));
    expect(fireWeapon(world, world.vehicles[0], 'rocket')).toBe(false);
    expect(world.vehicles[0].rockets).toBe(4);
  });
});

describe('supplies and match lifecycle', () => {
  it('caps repair health and ammo, and does not waste a full-health pickup', () => {
    const world = openWorld(),
      car = world.vehicles[0];
    world.pickups = [{ x: 0, z: 0, kind: 'repair', cooldown: 0 }];
    updatePickups(world, STEP);
    expect(world.pickups[0].cooldown).toBe(0);
    car.hp -= 10;
    updatePickups(world, STEP);
    expect(car.hp).toBe(car.def.health);
    expect(world.pickups[0].cooldown).toBe(16);
    world.pickups = [{ x: 0, z: 0, kind: 'ammo', cooldown: 0 }];
    car.rockets = 7;
    updatePickups(world, STEP);
    expect(car.rockets).toBe(MAX_ROCKETS);
  });
  it('respawns supplies after sixteen simulated seconds', () => {
    const world = openWorld();
    world.pickups = [{ x: 20, z: 20, kind: 'repair', cooldown: 16 }];
    updatePickups(world, 16);
    expect(world.pickups[0].cooldown).toBe(0);
  });
  it('freezes gameplay while paused', () => {
    const world = openWorld();
    world.phase = 'paused';
    const before = JSON.stringify(world);
    stepWorld(world, { ...emptyInput(), throttle: 1, gun: true });
    expect(JSON.stringify(world)).toBe(before);
  });
  it('ends with victory when every rival is gone', () => {
    const world = openWorld();
    world.vehicles.slice(1).forEach(v => damage(world, v, 1000, 0));
    stepWorld(world, emptyInput(), STEP, false);
    expect(world.phase).toBe('victory');
    expect(world.vehicles[0].kills).toBe(5);
  });
  it('gives defeat precedence for simultaneous player and final-rival destruction', () => {
    const world = openWorld();
    world.vehicles.forEach(v => damage(world, v, 1000));
    stepWorld(world, emptyInput(), STEP, false);
    expect(world.phase).toBe('defeat');
  });
  it('starts replay with independent fresh state', () => {
    const old = openWorld();
    old.vehicles[0].hp = 1;
    old.vehicles[0].rockets = 0;
    old.projectiles[0].active = true;
    const fresh = createWorld('goliath');
    expect(fresh.vehicles[0].hp).toBe(175);
    expect(fresh.vehicles[0].rockets).toBe(4);
    expect(fresh.projectiles.every(p => !p.active)).toBe(true);
    expect(fresh.time).toBe(0);
    expect(fresh.events).toHaveLength(0);
  });
});

describe('bot navigation', () => {
  it('reverses to recover after repeatedly failing to move', () => {
    const world = createWorld(),
      car = world.vehicles[1];
    car.bot.repath = 0;
    botInput(world, car, STEP);
    car.bot.repath = 0;
    const control = botInput(world, car, STEP);
    expect(control.throttle).toBeLessThan(0);
    expect(car.bot.reverse).toBeGreaterThan(0);
  });
  it('builds graph edges with enough clearance for the largest car', () => {
    const nodes = buildWaypoints(OBSTACLES);
    expect(nodes.length).toBeGreaterThan(20);
    for (const a of nodes)
      for (const j of a.links) expect(clearLine(a, nodes[j], OBSTACLES, 3.5)).toBe(true);
  });
  it('finds a detour around cover', () => {
    const nodes = buildWaypoints([wall]);
    const route = findRoute({ x: 0, z: 0 }, { x: 0, z: 30 }, nodes, [wall], 3);
    expect(route.length).toBeGreaterThan(0);
    let previous = { x: 0, z: 0 };
    for (const index of route) {
      expect(clearLine(previous, nodes[index], [wall], 3)).toBe(true);
      previous = nodes[index];
    }
    expect(clearLine(previous, { x: 0, z: 30 }, [wall], 3)).toBe(true);
  });
  it('moves bots and produces combat during a simulated match', () => {
    const world = createWorld();
    world.phase = 'playing';
    const initial = world.vehicles.slice(1).map(v => ({ x: v.x, z: v.z }));
    let fired = 0;
    for (let i = 0; i < 60 * 30 && world.phase === 'playing'; i++) {
      stepWorld(world, emptyInput());
      fired += world.events.filter(e => e.type === 'gun' || e.type === 'rocket').length;
    }
    expect(world.vehicles.slice(1).some((v, i) => distance(v, initial[i]) > 10)).toBe(true);
    expect(fired).toBeGreaterThan(0);
    expect(world.vehicles.every(v => Number.isFinite(v.x + v.z + v.hp))).toBe(true);
  });
});
