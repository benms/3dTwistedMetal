import { emptyInput } from '../src/config';
import {
  MAX_NAME_LENGTH,
  PROTOCOL_VERSION,
  encodeSnapshot,
  withAck,
  type ErrorReason,
  type LobbyState,
  type ServerMessage,
} from '../src/net/protocol';
import { MAX_DRIVERS, createMatch, fillDrivers, stepWorld } from '../src/simulation';
import type { GameEvent, InputState, VehicleId, World } from '../src/types';
import { silentLogger, type Logger } from './log';

/** The transport seen by a room: a socket in production, a stub in tests. */
export interface Peer {
  send(data: string): void;
  close(code: number, reason: string): void;
}

/**
 * Inputs to hold before consuming after the queue runs dry. Network jitter makes inputs
 * arrive unevenly; without this cushion the server would repeat stale controls on the
 * gaps and every gap would show up as a prediction correction on the client.
 */
const JITTER_BUFFER = 3;
/** Queued inputs beyond this are stale; dropping the oldest caps added latency. */
const MAX_QUEUED_INPUTS = 10;
/** After this many ticks without input, a player's car coasts instead of repeating controls. */
const IDLE_TICKS = 15;

interface Member {
  id: number;
  name: string;
  vehicle: VehicleId;
  peer: Peer;
  /** Seat in the running match, or -1 when waiting in the lobby. */
  seat: number;
  queue: { seq: number; input: InputState }[];
  lastSeq: number;
  ack: number;
  last: InputState;
  idle: number;
  /** Waiting for the jitter buffer to refill before consuming inputs again. */
  buffering: boolean;
}

export interface RoomOptions {
  /** Simulation ticks between snapshots. */
  snapshotEvery: number;
  snapshotHz: number;
  seed?: () => number;
  log?: Logger;
}

export function send(peer: Peer, message: ServerMessage): void {
  peer.send(JSON.stringify(message));
}

export class Room {
  private members = new Map<number, Member>();
  private nextId = 1;
  private hostId = -1;
  /** Bots the host asked for; fewer join when humans need the seats. */
  private botTarget = MAX_DRIVERS - 1;
  private tick = 0;
  private events: GameEvent[] = [];
  private readonly log: Logger;
  world: World | null = null;

  constructor(
    readonly code: string,
    private readonly options: RoomOptions,
  ) {
    this.log = (options.log ?? silentLogger).child({ room: code });
  }

  get size(): number {
    return this.members.size;
  }
  get playing(): boolean {
    return this.world !== null;
  }
  /** Bots in the next match: the host's choice, limited by free seats. */
  get bots(): number {
    return Math.min(this.botTarget, MAX_DRIVERS - this.members.size);
  }

  join(peer: Peer, name: string, vehicle: VehicleId): number | ErrorReason {
    if (this.playing) return 'match-in-progress';
    if (this.members.size >= MAX_DRIVERS) return 'room-full';
    const id = this.nextId++;
    this.members.set(id, {
      id,
      name: this.uniqueName(name),
      vehicle,
      peer,
      seat: -1,
      queue: [],
      lastSeq: 0,
      ack: 0,
      last: emptyInput(),
      idle: 0,
      buffering: true,
    });
    if (this.hostId < 0) this.hostId = id;
    this.log.info('player joined', { player: id, players: this.members.size });
    this.broadcastLobby();
    return id;
  }

  /** A player who leaves mid-match hands their car to a bot so the match plays on. */
  leave(id: number): void {
    const member = this.members.get(id);
    if (!member) return;
    this.members.delete(id);
    if (this.world && member.seat >= 0) this.world.vehicles[member.seat].human = false;
    // The longest-standing remaining player inherits the host role.
    if (this.hostId === id) this.hostId = this.members.size ? Math.min(...this.members.keys()) : -1;
    this.log.info('player left', { player: id, players: this.members.size });
    if (this.members.size) this.broadcastLobby();
    else this.world = null;
  }

  select(id: number, vehicle: VehicleId): void {
    const member = this.members.get(id);
    if (!member || this.playing) return;
    member.vehicle = vehicle;
    this.broadcastLobby();
  }

  /** Host only, between matches: choose how many bots take the remaining seats. */
  setBots(id: number, count: number): ErrorReason | null {
    if (id !== this.hostId) return 'not-host';
    if (this.playing) return 'match-in-progress';
    this.botTarget = Math.max(0, Math.min(count, MAX_DRIVERS - this.members.size));
    this.broadcastLobby();
    return null;
  }

  start(id: number): ErrorReason | null {
    if (id !== this.hostId) return 'not-host';
    if (this.playing) return 'match-in-progress';
    const seated = [...this.members.values()].sort((a, b) => a.id - b.id);
    const drivers = fillDrivers(seated, this.bots);
    const seed = this.options.seed?.() || 18471;
    this.world = createMatch(drivers, seed);
    this.world.phase = 'playing';
    this.tick = 0;
    this.events = [];
    seated.forEach((member, seat) => {
      Object.assign(member, {
        seat,
        queue: [],
        lastSeq: 0,
        ack: 0,
        last: emptyInput(),
        idle: 0,
        buffering: true,
      });
      send(member.peer, {
        t: 'start',
        localId: seat,
        drivers,
        seed,
        snapshotHz: this.options.snapshotHz,
      });
    });
    this.log.info('match started', { humans: seated.length, protocol: PROTOCOL_VERSION });
    this.broadcastSnapshot();
    return null;
  }

  input(id: number, seq: number, input: InputState): void {
    const member = this.members.get(id);
    if (!member || member.seat < 0 || seq <= member.lastSeq) return;
    member.lastSeq = seq;
    member.queue.push({ seq, input });
    if (member.queue.length > MAX_QUEUED_INPUTS) member.queue.shift();
  }

  /** One 60 Hz simulation tick, consuming at most one buffered input per player. */
  step(): void {
    const world = this.world;
    if (!world) return;
    const inputs: Record<number, InputState> = {};
    for (const member of this.members.values()) {
      if (member.seat < 0 || !world.vehicles[member.seat].human) continue;
      if (member.queue.length >= JITTER_BUFFER) member.buffering = false;
      const next = member.buffering ? undefined : member.queue.shift();
      if (!member.queue.length) member.buffering = true;
      if (next) {
        member.last = next.input;
        member.ack = next.seq;
        member.idle = 0;
      } else if (++member.idle > IDLE_TICKS)
        member.last = { ...emptyInput(), selectedWeapon: member.last.selectedWeapon };
      inputs[member.seat] = member.last;
    }
    stepWorld(world, inputs);
    this.events.push(...world.events);
    this.tick++;
    if (world.phase === 'over') {
      this.broadcastSnapshot();
      this.log.info('match finished', { winner: world.winner, seconds: Math.round(world.time) });
      this.world = null;
      for (const member of this.members.values()) member.seat = -1;
      this.broadcastLobby();
    } else if (this.tick % this.options.snapshotEvery === 0) this.broadcastSnapshot();
  }

  /** Tell every player why the room is closing, then disconnect them. */
  close(reason: ErrorReason): void {
    for (const member of this.members.values()) {
      send(member.peer, { t: 'error', reason, fatal: true });
      member.peer.close(reason === 'server-restarting' ? 1012 : 1000, reason);
    }
    this.members.clear();
    this.world = null;
  }

  lobby(you: number): LobbyState {
    return {
      code: this.code,
      you,
      players: [...this.members.values()]
        .sort((a, b) => a.id - b.id)
        .map(m => ({ id: m.id, name: m.name, vehicle: m.vehicle, host: m.id === this.hostId })),
      bots: this.bots,
    };
  }

  private broadcastLobby(): void {
    for (const member of this.members.values())
      send(member.peer, { t: 'lobby', lobby: this.lobby(member.id) });
  }

  private broadcastSnapshot(): void {
    if (!this.world) return;
    const body = JSON.stringify(encodeSnapshot(this.world, this.tick, this.events));
    this.events = [];
    for (const member of this.members.values())
      if (member.seat >= 0) member.peer.send(withAck(body, member.ack));
  }

  private uniqueName(name: string): string {
    const taken = new Set([...this.members.values()].map(m => m.name));
    if (!taken.has(name)) return name;
    for (let n = 2; ; n++) {
      const suffix = ` ${n}`;
      const candidate = name.slice(0, MAX_NAME_LENGTH - suffix.length) + suffix;
      if (!taken.has(candidate)) return candidate;
    }
  }
}
