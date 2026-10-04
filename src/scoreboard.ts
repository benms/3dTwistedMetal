import type { World } from './types';

export interface ScoreboardRow {
  rank: number;
  driverId: number;
  driverName: string;
  vehicleName: string;
  kills: number;
  survivalSeconds: number;
  alive: boolean;
  isPlayer: boolean;
}

/** A snapshot of all drivers when this round ends; it never reorders the world. */
export function buildScoreboard(
  world: Pick<World, 'time' | 'vehicles'>,
  localId = 0,
): ScoreboardRow[] {
  const rows = world.vehicles.map(vehicle => ({
    rank: 0,
    driverId: vehicle.id,
    driverName: vehicle.name,
    vehicleName: vehicle.def.name,
    kills: vehicle.kills,
    survivalSeconds: vehicle.dead ? (vehicle.eliminatedAt ?? world.time) : world.time,
    alive: !vehicle.dead,
    isPlayer: vehicle.id === localId,
  }));
  rows.sort(
    (a, b) =>
      Number(b.alive) - Number(a.alive) ||
      b.kills - a.kills ||
      b.survivalSeconds - a.survivalSeconds ||
      a.driverId - b.driverId,
  );
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}
