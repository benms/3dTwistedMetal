import { emptyInput } from '../config';
import { FixedStepper, createMatch } from '../simulation';
import type { GameEvent, InputState, VehicleId, World } from '../types';
import { NetClient, type ConnectionStatus } from './client';
import { SnapshotBuffer } from './interpolation';
import { Predictor } from './prediction';
import {
  PROTOCOL_VERSION,
  type ErrorReason,
  type LobbyState,
  type ServerMessage,
  type SnapshotMessage,
} from './protocol';

export interface SessionEvents {
  status(status: ConnectionStatus): void;
  lobby(lobby: LobbyState): void;
  /** A match began; `world` is the client view that `frame` keeps updating. */
  start(world: World, localId: number): void;
  event(e: GameEvent): void;
  error(reason: ErrorReason): void;
  /** The connection ended; `reason` is set when the server explained why first. */
  disconnected(reason?: ErrorReason): void;
}

/**
 * One online seat: lobby state, your predicted car, and everyone else interpolated from
 * server snapshots into a view `World` that the renderer, HUD and audio read as usual.
 */
export class NetworkSession {
  lobby: LobbyState | null = null;
  world: World | null = null;
  localId = -1;
  private client: NetClient;
  private buffer = new SnapshotBuffer();
  private predictor: Predictor | null = null;
  private stepper = new FixedStepper();
  private latest: SnapshotMessage | null = null;
  private localInput: InputState = emptyInput();
  private fatal?: ErrorReason;

  constructor(
    url: string,
    private readonly events: SessionEvents,
    createSocket?: (url: string) => WebSocket,
    private readonly now: () => number = () => performance.now() / 1000,
  ) {
    this.client = new NetClient(
      url,
      {
        status: status => events.status(status),
        message: msg => this.receive(msg),
        closed: () => {
          this.reset();
          events.disconnected(this.fatal);
        },
      },
      createSocket,
    );
  }

  get rtt(): number {
    return this.client.rtt;
  }
  get connected(): boolean {
    return this.client.connected;
  }
  /** True while your own car is alive in a running match and driven by local input. */
  get driving(): boolean {
    return (
      !!this.predictor && this.latest?.phase !== 'over' && this.latest?.v[this.localId]?.d !== 1
    );
  }

  async create(name: string, vehicle: VehicleId): Promise<void> {
    this.fatal = undefined;
    await this.client.connect();
    this.client.send({ t: 'create', v: PROTOCOL_VERSION, name, vehicle });
  }
  async join(code: string, name: string, vehicle: VehicleId): Promise<void> {
    this.fatal = undefined;
    await this.client.connect();
    this.client.send({ t: 'join', v: PROTOCOL_VERSION, code, name, vehicle });
  }
  select(vehicle: VehicleId): void {
    this.client.send({ t: 'select', vehicle });
  }
  start(): void {
    this.client.send({ t: 'start' });
  }
  /** Host only: how many bots join the next match. */
  setBots(count: number): void {
    this.client.send({ t: 'bots', count });
  }
  /** Leave the room and close the socket; also cancels a connection still waking up. */
  leave(): void {
    this.client.send({ t: 'leave' });
    this.client.close();
    this.reset();
    this.lobby = null;
  }

  /**
   * Advance one rendered frame: send and predict local input at the fixed tick rate, then
   * place every other car at its interpolated position. Poses are written with prev equal
   * to current, so the renderer can draw the view world with any interpolation alpha.
   */
  frame(dt: number, readInput: () => InputState): void {
    const world = this.world;
    if (!world) return;
    const predictor = this.predictor;
    let alpha = 1;
    if (predictor && this.driving)
      alpha = this.stepper.advance(dt, () => {
        const input = readInput();
        this.localInput = input;
        const seq = predictor.step(world, input, kind => {
          // Your own shots flash and sound immediately; the server's echo is skipped below.
          const car = predictor.car;
          this.events.event({ type: kind, x: car.x, z: car.z, power: 1, owner: this.localId });
        });
        this.client.send({ t: 'input', seq, input });
      });
    else this.stepper.reset();
    this.buffer.sample(world, this.now(), this.driving ? this.localId : -1, e => {
      if ((e.type === 'gun' || e.type === 'rocket') && e.owner === this.localId) return;
      this.events.event(e);
    });
    const own = world.vehicles[this.localId];
    const fresh = this.latest?.v[this.localId];
    if (!own || !fresh) return;
    // Your own HUD shows the newest server facts rather than the delayed playback.
    own.hp = fresh.hp;
    own.kills = fresh.k;
    own.lastHit = fresh.lh;
    if (predictor && this.driving) {
      const pose = predictor.render(dt, alpha);
      own.x = own.prevX = pose.x;
      own.z = own.prevZ = pose.z;
      own.heading = own.prevHeading = pose.heading;
      own.vx = predictor.car.vx;
      own.vz = predictor.car.vz;
      own.boost = predictor.car.boost;
      own.rockets = predictor.car.rockets;
      own.gunCooldown = predictor.car.gunCooldown;
      own.rocketCooldown = predictor.car.rocketCooldown;
      own.control = this.localInput;
    }
  }

  private receive(msg: ServerMessage): void {
    switch (msg.t) {
      case 'lobby':
        this.lobby = msg.lobby;
        this.events.lobby(msg.lobby);
        break;
      case 'start': {
        const world = createMatch(msg.drivers, msg.seed);
        world.phase = 'playing';
        this.world = world;
        this.localId = msg.localId;
        this.predictor = new Predictor(world.vehicles[msg.localId]);
        // Two snapshot intervals of playback delay absorb one late or lost update.
        this.buffer.reset(Math.max(0.1, 2.2 / msg.snapshotHz));
        this.latest = null;
        this.localInput = emptyInput();
        this.stepper.reset();
        this.events.start(world, msg.localId);
        break;
      }
      case 'snapshot': {
        if (!this.world) return;
        this.buffer.push(msg, this.now());
        this.latest = msg;
        const own = msg.v[this.localId];
        if (this.predictor && own && own.d === 0 && msg.phase === 'playing')
          this.predictor.reconcile(this.world, own, msg.ack);
        break;
      }
      case 'error':
        if (msg.fatal) this.fatal = msg.reason;
        this.events.error(msg.reason);
        break;
      case 'pong':
        break;
    }
  }

  private reset(): void {
    this.world = null;
    this.predictor = null;
    this.latest = null;
    this.localId = -1;
    this.buffer.reset();
  }
}
