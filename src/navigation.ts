import { ARENA, emptyInput } from './config';
import { angleDelta, clamp, clearLine, distance } from './math';
import type { InputState, Obstacle, Vec2, Vehicle, Waypoint, World } from './types';

export function buildWaypoints(obstacles: Obstacle[]): Waypoint[] {
  const coordinates = [-65, -43, -21, 0, 21, 43, 65];
  const nodes: Waypoint[] = [];
  for (const x of coordinates)
    for (const z of coordinates) {
      const p = { x, z };
      if (clearLine(p, p, obstacles, 3.5)) nodes.push({ ...p, links: [] });
    }
  nodes.forEach((a, i) =>
    nodes.forEach((b, j) => {
      if (i !== j && distance(a, b) < 32 && clearLine(a, b, obstacles, 3.5)) a.links.push(j);
    }),
  );
  return nodes;
}

export function findRoute(
  from: Vec2,
  to: Vec2,
  nodes: Waypoint[],
  obstacles: Obstacle[],
  radius: number,
): number[] {
  if (clearLine(from, to, obstacles, radius)) return [];
  const nearest = (p: Vec2): number => {
    let best = -1,
      cost = Infinity;
    nodes.forEach((n, i) => {
      const d = distance(p, n);
      if (d < cost && clearLine(p, n, obstacles, radius)) {
        best = i;
        cost = d;
      }
    });
    return best;
  };
  const start = nearest(from),
    end = nearest(to);
  if (start < 0 || end < 0) return [];
  const costs = nodes.map(() => Infinity),
    parent = nodes.map(() => -1),
    open = new Set([start]);
  costs[start] = 0;
  while (open.size) {
    let current = -1,
      score = Infinity;
    for (const i of open) {
      const f = costs[i] + distance(nodes[i], nodes[end]);
      if (f < score) {
        current = i;
        score = f;
      }
    }
    if (current === end) {
      const route: number[] = [];
      for (let n = end; n !== -1; n = parent[n]) route.unshift(n);
      return route;
    }
    open.delete(current);
    for (const next of nodes[current].links) {
      const g = costs[current] + distance(nodes[current], nodes[next]);
      if (g < costs[next]) {
        costs[next] = g;
        parent[next] = current;
        open.add(next);
      }
    }
  }
  return [];
}

export function botInput(world: World, car: Vehicle, dt: number): InputState {
  const input = emptyInput(),
    bot = car.bot;
  let target = world.vehicles.find(v => v.id === bot.target && !v.dead && v.id !== car.id);
  bot.repath -= dt;
  if (!target || bot.repath <= 0) {
    target = world.vehicles
      .filter(v => v.id !== car.id && !v.dead)
      .sort((a, b) => distance(car, a) - distance(car, b))[0];
    bot.target = target?.id ?? -1;
  }
  if (!target) return input;
  let goal: Vec2 = target;
  const supplies = world.pickups.filter(
    p =>
      p.cooldown <= 0 &&
      ((p.kind === 'repair' && car.hp < car.def.health * 0.65) ||
        (p.kind === 'ammo' && car.rockets === 0)),
  );
  supplies.sort((a, b) => distance(car, a) - distance(car, b));
  if (supplies[0] && distance(car, supplies[0]) < 55) goal = supplies[0];
  if (bot.repath <= 0) {
    bot.path = findRoute(car, goal, world.nodes, world.obstacles, car.def.radius + 0.65);
    bot.repath = 0.65 + car.id * 0.05;
    if (distance(car, { x: bot.lastX, z: bot.lastZ }) < 0.9) bot.stuck += 0.8;
    else bot.stuck = 0;
    bot.lastX = car.x;
    bot.lastZ = car.z;
    if (bot.stuck > 1.5) {
      bot.reverse = 1.15;
      bot.stuck = 0;
      bot.dodge *= -1;
    }
  }
  while (bot.path.length && distance(car, world.nodes[bot.path[0]]) < 5) bot.path.shift();
  const waypoint = bot.path.length ? world.nodes[bot.path[0]] : goal;
  const desired = Math.atan2(waypoint.x - car.x, waypoint.z - car.z);
  const error = angleDelta(car.heading, desired);
  input.steer = clamp(-error * 1.7, -1, 1);
  input.throttle = Math.abs(error) > 1.3 ? 0.43 : 0.83;
  input.brake = Math.abs(error) > 1 && Math.hypot(car.vx, car.vz) > 16;
  const ahead = { x: car.x + Math.sin(car.heading) * 8, z: car.z + Math.cos(car.heading) * 8 };
  if (!clearLine(car, ahead, world.obstacles, car.def.radius + 0.4)) {
    input.throttle = 0.4;
    input.steer = Math.abs(error) > 0.1 ? -Math.sign(error) : bot.dodge;
  }
  if (Math.abs(ahead.x) > ARENA - 3 || Math.abs(ahead.z) > ARENA - 3) {
    input.steer = -Math.sign(angleDelta(car.heading, Math.atan2(-car.x, -car.z)));
  }
  if (bot.reverse > 0) {
    bot.reverse -= dt;
    input.throttle = -0.8;
    input.steer = bot.dodge;
    input.brake = false;
  }
  const targetAngle = Math.abs(
    angleDelta(car.heading, Math.atan2(target.x - car.x, target.z - car.z)),
  );
  const visible = clearLine(car, target, world.obstacles);
  input.gun = world.time > 2 && targetAngle < 0.14 && distance(car, target) < 65 && visible;
  input.rocket =
    world.time > 4 &&
    targetAngle < 0.3 &&
    distance(car, target) < 52 &&
    distance(car, target) > 12 &&
    visible &&
    Math.sin(world.time * 1.4 + car.id * 2) > 0.75;
  input.boost = Math.abs(error) < 0.15 && distance(car, waypoint) > 35 && car.boost > 50 && visible;
  return input;
}
