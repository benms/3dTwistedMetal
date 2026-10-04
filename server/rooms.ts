import {
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  parseClientMessage,
  type ClientMessage,
  type ErrorReason,
} from '../src/net/protocol';
import { silentLogger, type Logger } from './log';
import { Room, send, type Peer } from './room';

export interface RoomManagerOptions {
  maxRooms: number;
  snapshotHz: number;
  maxMessagesPerSecond: number;
  log?: Logger;
  /** Uniform random integer in [0, max); injectable for deterministic tests. */
  randomInt?: (max: number) => number;
  now?: () => number;
}

/** One connected socket: rate limiting, message validation and its current room seat. */
export interface Connection {
  receive(raw: string): void;
  closed(): void;
  /** Monotonic time of the last message, for detecting dead sockets. */
  lastSeen: number;
}

const defaultRandomInt = (max: number) => {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % max;
};

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly log: Logger;
  private readonly randomInt: (max: number) => number;
  private readonly now: () => number;
  private connections = 0;

  constructor(private readonly options: RoomManagerOptions) {
    this.log = options.log ?? silentLogger;
    this.randomInt = options.randomInt ?? defaultRandomInt;
    this.now = options.now ?? (() => performance.now());
  }

  get stats(): { rooms: number; players: number; connections: number; matches: number } {
    let players = 0,
      matches = 0;
    for (const room of this.rooms.values()) {
      players += room.size;
      if (room.playing) matches++;
    }
    return { rooms: this.rooms.size, players, connections: this.connections, matches };
  }

  /** Advance every running match by one fixed step. */
  tick(): void {
    for (const room of this.rooms.values()) room.step();
  }

  /** Graceful shutdown: every player hears why before their socket closes. */
  shutdown(): void {
    for (const room of this.rooms.values()) room.close('server-restarting');
    this.rooms.clear();
  }

  connect(peer: Peer): Connection {
    this.connections++;
    let room: Room | undefined;
    let memberId = -1;
    let tokens = this.options.maxMessagesPerSecond;
    let refilled = this.now();
    let open = true;
    const manager = this;
    const fail = (reason: ErrorReason, fatal = false) => {
      send(peer, { t: 'error', reason, fatal });
      if (fatal) {
        peer.close(1008, reason);
        connection.closed();
      }
    };
    const leaveRoom = () => {
      if (!room) return;
      room.leave(memberId);
      if (!room.size) {
        this.rooms.delete(room.code);
        this.log.info('room closed', { room: room.code });
      }
      room = undefined;
      memberId = -1;
    };
    const enter = (target: Room, msg: Extract<ClientMessage, { t: 'create' | 'join' }>) => {
      const result = target.join(peer, msg.name, msg.vehicle);
      if (typeof result === 'string') return fail(result);
      room = target;
      memberId = result;
    };
    const handle = (msg: ClientMessage) => {
      switch (msg.t) {
        case 'create': {
          if (msg.v !== PROTOCOL_VERSION) return fail('version', true);
          leaveRoom();
          if (this.rooms.size >= this.options.maxRooms) return fail('server-full');
          const created = new Room(this.newCode(), {
            snapshotHz: this.options.snapshotHz,
            snapshotEvery: Math.max(1, Math.round(60 / this.options.snapshotHz)),
            seed: () => this.randomInt(0x7fffffff) + 1,
            log: this.log,
          });
          this.rooms.set(created.code, created);
          this.log.info('room created', { room: created.code, rooms: this.rooms.size });
          return enter(created, msg);
        }
        case 'join': {
          if (msg.v !== PROTOCOL_VERSION) return fail('version', true);
          const target = this.rooms.get(msg.code);
          if (!target) return fail('room-not-found');
          if (target === room) return;
          leaveRoom();
          return enter(target, msg);
        }
        case 'select':
          return room?.select(memberId, msg.vehicle);
        case 'start': {
          const error = room?.start(memberId);
          return error ? fail(error) : undefined;
        }
        case 'bots': {
          const error = room?.setBots(memberId, msg.count);
          return error ? fail(error) : undefined;
        }
        case 'input':
          return room?.input(memberId, msg.seq, msg.input);
        case 'ping':
          return send(peer, { t: 'pong', at: msg.at });
        case 'leave':
          return leaveRoom();
      }
    };
    const connection: Connection = {
      lastSeen: this.now(),
      receive(raw: string) {
        if (!open) return;
        const now = manager.now();
        connection.lastSeen = now;
        // Token bucket: a burst of one second's allowance, refilled continuously.
        const rate = manager.options.maxMessagesPerSecond;
        tokens = Math.min(rate, tokens + ((now - refilled) / 1000) * rate);
        refilled = now;
        if (tokens < 1) return fail('rate-limit', true);
        tokens--;
        const msg = parseClientMessage(raw);
        if (!msg) return fail('bad-request', true);
        handle(msg);
      },
      closed() {
        if (!open) return;
        open = false;
        manager.connections--;
        leaveRoom();
      },
    };
    return connection;
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++)
        code += ROOM_CODE_ALPHABET[this.randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }
}
