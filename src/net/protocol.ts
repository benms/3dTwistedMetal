import { VEHICLE_IDS, WEAPON_ORDER, emptyInput } from '../config';
import { MAX_DRIVERS } from '../simulation';
import type {
  DriverSpec,
  GameEvent,
  InputState,
  Projectile,
  VehicleId,
  WeaponId,
  World,
} from '../types';

/** Bumped whenever client and server messages stop being compatible. */
export const PROTOCOL_VERSION = 2;
export const MAX_NAME_LENGTH = 16;
export const ROOM_CODE_LENGTH = 4;
/** No I or O, so codes read unambiguously aloud and next to 1 and 0. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface LobbyPlayer {
  id: number;
  name: string;
  vehicle: VehicleId;
  host: boolean;
}
export interface LobbyState {
  code: string;
  /** Your own player id inside this room. */
  you: number;
  players: LobbyPlayer[];
  /** Bots that will join the next match; the host can change it between matches. */
  bots: number;
}

export type ClientMessage =
  | { t: 'create'; v: number; name: string; vehicle: VehicleId }
  | { t: 'join'; v: number; code: string; name: string; vehicle: VehicleId }
  | { t: 'select'; vehicle: VehicleId }
  | { t: 'start' }
  | { t: 'bots'; count: number }
  | { t: 'input'; seq: number; input: InputState }
  | { t: 'ping'; at: number }
  | { t: 'leave' };

export type ErrorReason =
  | 'bad-request'
  | 'version'
  | 'room-not-found'
  | 'room-full'
  | 'match-in-progress'
  | 'server-full'
  | 'not-host'
  | 'rate-limit'
  | 'server-restarting';

/** Compact per-car state. Kinematics are exact enough to reconcile prediction against. */
export interface VehicleSnap {
  x: number;
  z: number;
  h: number;
  vx: number;
  vz: number;
  hp: number;
  /** Boost reserve. */
  b: number;
  /** Rockets. */
  r: number;
  gc: number;
  rc: number;
  /** Kills. */
  k: number;
  /** 1 when wrecked. */
  d: 0 | 1;
  /** 1 when a human is driving. */
  hu: 0 | 1;
  /** Elimination time, -1 while alive. */
  el: number;
  /** Time of the last hit taken. */
  lh: number;
  /** Controls for visuals: throttle, steer, flags (brake 1, boost 2, gun 4, rocket 8), weapon index. */
  c: [number, number, number, number];
}
/** Pool index, kind (0 bullet, 1 rocket), owner, x, z, heading. */
export type ProjectileSnap = [number, 0 | 1, number, number, number, number];

export interface SnapshotMessage {
  t: 'snapshot';
  /** Last input sequence the server applied for the receiving player. */
  ack: number;
  tick: number;
  time: number;
  phase: 'playing' | 'over';
  winner: number | null;
  v: VehicleSnap[];
  p: ProjectileSnap[];
  /** Pickup cooldowns. */
  pk: number[];
  /** Live barrels as a bitmask. */
  br: number;
  /** Events raised since the previous snapshot. */
  e: GameEvent[];
}

export type ServerMessage =
  | { t: 'lobby'; lobby: LobbyState }
  | {
      t: 'start';
      localId: number;
      drivers: DriverSpec[];
      seed: number;
      snapshotHz: number;
    }
  | SnapshotMessage
  | { t: 'pong'; at: number }
  | { t: 'error'; reason: ErrorReason; fatal: boolean };

const round = (n: number) => Math.round(n * 1000) / 1000;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const clampUnit = (value: unknown) => Math.max(-1, Math.min(1, finite(value)));

export function isVehicleId(value: unknown): value is VehicleId {
  return typeof value === 'string' && (VEHICLE_IDS as string[]).includes(value);
}

/** Upper-case letters, digits and a little punctuation; never empty. */
export function sanitizeName(raw: unknown): string {
  const name = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ._-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return name || 'DRIVER';
}

export function normalizeRoomCode(raw: unknown): string {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

/** Never trust a client's controls: clamp axes, coerce flags, whitelist the weapon. */
export function sanitizeInput(raw: unknown): InputState {
  if (!isRecord(raw)) return emptyInput();
  const weapon = (WEAPON_ORDER as readonly string[]).includes(raw.selectedWeapon as string)
    ? (raw.selectedWeapon as WeaponId)
    : 'bullet';
  return {
    selectedWeapon: weapon,
    throttle: clampUnit(raw.throttle),
    steer: clampUnit(raw.steer),
    brake: raw.brake === true,
    boost: raw.boost === true,
    gun: raw.gun === true,
    rocket: raw.rocket === true,
  };
}

/** Validate one client frame; anything malformed returns null. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  switch (data.t) {
    case 'create':
      if (!isVehicleId(data.vehicle)) return null;
      return {
        t: 'create',
        v: finite(data.v),
        name: sanitizeName(data.name),
        vehicle: data.vehicle,
      };
    case 'join': {
      const code = normalizeRoomCode(data.code);
      if (!isVehicleId(data.vehicle) || code.length !== ROOM_CODE_LENGTH) return null;
      return {
        t: 'join',
        v: finite(data.v),
        code,
        name: sanitizeName(data.name),
        vehicle: data.vehicle,
      };
    }
    case 'select':
      return isVehicleId(data.vehicle) ? { t: 'select', vehicle: data.vehicle } : null;
    case 'start':
      return { t: 'start' };
    case 'bots': {
      const count = finite(data.count, -1);
      return Number.isInteger(count) && count >= 0 && count < MAX_DRIVERS
        ? { t: 'bots', count }
        : null;
    }
    case 'input': {
      const seq = finite(data.seq, -1);
      if (!Number.isSafeInteger(seq) || seq < 1) return null;
      return { t: 'input', seq, input: sanitizeInput(data.input) };
    }
    case 'ping':
      return { t: 'ping', at: finite(data.at) };
    case 'leave':
      return { t: 'leave' };
    default:
      return null;
  }
}

function controlFlags(input: InputState): number {
  return (
    (input.brake ? 1 : 0) | (input.boost ? 2 : 0) | (input.gun ? 4 : 0) | (input.rocket ? 8 : 0)
  );
}

/** Build the shared part of a snapshot; `ack` is added per recipient by {@link withAck}. */
export function encodeSnapshot(
  world: World,
  tick: number,
  events: readonly GameEvent[],
): Omit<SnapshotMessage, 'ack'> {
  const projectiles: ProjectileSnap[] = [];
  world.projectiles.forEach((p, i) => {
    if (p.active)
      projectiles.push([
        i,
        p.kind === 'rocket' ? 1 : 0,
        p.owner,
        round(p.x),
        round(p.z),
        round(p.heading),
      ]);
  });
  return {
    t: 'snapshot',
    tick,
    time: round(world.time),
    phase: world.phase === 'over' ? 'over' : 'playing',
    winner: world.winner,
    v: world.vehicles.map(car => ({
      x: round(car.x),
      z: round(car.z),
      h: round(car.heading),
      vx: round(car.vx),
      vz: round(car.vz),
      hp: round(car.hp),
      b: round(car.boost),
      r: car.rockets,
      gc: round(car.gunCooldown),
      rc: round(car.rocketCooldown),
      k: car.kills,
      d: car.dead ? 1 : 0,
      hu: car.human ? 1 : 0,
      el: car.eliminatedAt === null ? -1 : round(car.eliminatedAt),
      lh: round(car.lastHit),
      c: [
        round(car.control.throttle),
        round(car.control.steer),
        controlFlags(car.control),
        Math.max(0, WEAPON_ORDER.indexOf(car.control.selectedWeapon)),
      ],
    })),
    p: projectiles,
    pk: world.pickups.map(p => round(p.cooldown)),
    br: world.barrels.reduce((mask, b, i) => (b.alive ? mask | (1 << i) : mask), 0),
    e: events.map(e => ({ ...e, x: round(e.x), z: round(e.z) })),
  };
}

/** Serialize the shared body once, then prefix each recipient's acknowledgement cheaply. */
export function withAck(body: string, ack: number): string {
  return `{"ack":${ack},${body.slice(1)}`;
}

export function decodeControl(c: VehicleSnap['c']): InputState {
  return {
    throttle: c[0],
    steer: c[1],
    brake: (c[2] & 1) !== 0,
    boost: (c[2] & 2) !== 0,
    gun: (c[2] & 4) !== 0,
    rocket: (c[2] & 8) !== 0,
    selectedWeapon: WEAPON_ORDER[c[3]] ?? 'bullet',
  };
}

/** Copy one car's snapshot onto a client-side vehicle, settling it at that pose. */
export function applyVehicleSnap(car: World['vehicles'][number], s: VehicleSnap): void {
  car.x = car.prevX = s.x;
  car.z = car.prevZ = s.z;
  car.heading = car.prevHeading = s.h;
  car.vx = s.vx;
  car.vz = s.vz;
  car.hp = s.hp;
  car.boost = s.b;
  car.rockets = s.r;
  car.gunCooldown = s.gc;
  car.rocketCooldown = s.rc;
  car.kills = s.k;
  car.dead = s.d === 1;
  car.human = s.hu === 1;
  car.eliminatedAt = s.el < 0 ? null : s.el;
  car.lastHit = s.lh;
  car.control = decodeControl(s.c);
}

/** Write a snapshot's full state into a client view of the world. */
export function applySnapshot(world: World, snap: Omit<SnapshotMessage, 'ack'>): void {
  world.time = snap.time;
  world.phase = snap.phase;
  world.winner = snap.winner;
  snap.v.forEach((s, i) => {
    const car = world.vehicles[i];
    if (car) applyVehicleSnap(car, s);
  });
  for (const p of world.projectiles) p.active = false;
  for (const [index, kind, owner, x, z, heading] of snap.p) {
    const p: Projectile | undefined = world.projectiles[index];
    if (!p) continue;
    Object.assign(p, {
      active: true,
      kind: kind === 1 ? 'rocket' : 'bullet',
      owner,
      x,
      z,
      prevX: x,
      prevZ: z,
      heading,
    });
  }
  snap.pk.forEach((cooldown, i) => {
    if (world.pickups[i]) world.pickups[i].cooldown = cooldown;
  });
  world.barrels.forEach((b, i) => (b.alive = (snap.br & (1 << i)) !== 0));
}
