import { describe, expect, it } from 'vitest';
import { emptyInput } from '../src/config';
import { PROTOCOL_VERSION, type ServerMessage } from '../src/net/protocol';
import type { Peer } from '../server/room';
import { RoomManager, type Connection } from '../server/rooms';

class FakePeer implements Peer {
  messages: ServerMessage[] = [];
  closedWith: [number, string] | null = null;
  send(data: string): void {
    this.messages.push(JSON.parse(data) as ServerMessage);
  }
  close(code: number, reason: string): void {
    this.closedWith = [code, reason];
  }
  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    return this.messages.filter(m => m.t === t).at(-1) as Extract<ServerMessage, { t: T }>;
  }
}

function setup(overrides: Partial<ConstructorParameters<typeof RoomManager>[0]> = {}) {
  let clock = 0;
  const manager = new RoomManager({
    maxRooms: 4,
    snapshotHz: 20,
    maxMessagesPerSecond: 120,
    randomInt: max => 7 % max,
    now: () => clock,
    ...overrides,
  });
  const connect = () => {
    const peer = new FakePeer();
    const conn = manager.connect(peer);
    const say = (msg: object) => conn.receive(JSON.stringify(msg));
    return { peer, conn, say };
  };
  return { manager, connect, advance: (ms: number) => (clock += ms) };
}

function createRoom(
  connect: () => { peer: FakePeer; conn: Connection; say: (m: object) => void },
  name = 'HOST',
) {
  const host = connect();
  host.say({ t: 'create', v: PROTOCOL_VERSION, name, vehicle: 'viper' });
  const code = host.peer.last('lobby')!.lobby.code;
  return { host, code };
}

describe('room lifecycle', () => {
  it('creates a room with a readable code and makes the creator host', () => {
    const { connect } = setup();
    const { host, code } = createRoom(connect);
    expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(host.peer.last('lobby')!.lobby.players).toEqual([
      { id: 1, name: 'HOST', vehicle: 'viper', host: true },
    ]);
  });
  it('lets others join by code and shares vehicle choices', () => {
    const { connect } = setup();
    const { host, code } = createRoom(connect);
    const guest = connect();
    guest.say({
      t: 'join',
      v: PROTOCOL_VERSION,
      code: code.toLowerCase(),
      name: 'host',
      vehicle: 'goliath',
    });
    guest.say({ t: 'select', vehicle: 'hellion' });
    const lobby = host.peer.last('lobby')!.lobby;
    expect(lobby.players.map(p => [p.name, p.vehicle, p.host])).toEqual([
      ['HOST', 'viper', true],
      ['HOST 2', 'hellion', false],
    ]);
    expect(guest.peer.last('lobby')!.lobby.you).toBe(2);
  });
  it('rejects unknown codes, full rooms and outdated clients', () => {
    const { connect } = setup();
    const { code } = createRoom(connect);
    const lost = connect();
    lost.say({ t: 'join', v: PROTOCOL_VERSION, code: 'ZZZZ', name: 'x', vehicle: 'viper' });
    expect(lost.peer.last('error')).toMatchObject({ reason: 'room-not-found', fatal: false });
    for (let i = 0; i < 5; i++)
      connect().say({ t: 'join', v: PROTOCOL_VERSION, code, name: `p${i}`, vehicle: 'viper' });
    const seventh = connect();
    seventh.say({ t: 'join', v: PROTOCOL_VERSION, code, name: 'late', vehicle: 'viper' });
    expect(seventh.peer.last('error')?.reason).toBe('room-full');
    const old = connect();
    old.say({ t: 'create', v: 0, name: 'x', vehicle: 'viper' });
    expect(old.peer.last('error')).toMatchObject({ reason: 'version', fatal: true });
    expect(old.peer.closedWith?.[0]).toBe(1008);
  });
  it('caps the number of rooms', () => {
    let n = 0;
    const { connect, manager } = setup({ maxRooms: 2, randomInt: max => n++ % max });
    createRoom(connect);
    createRoom(connect);
    const third = connect();
    third.say({ t: 'create', v: PROTOCOL_VERSION, name: 'x', vehicle: 'viper' });
    expect(third.peer.last('error')?.reason).toBe('server-full');
    expect(manager.rooms.size).toBe(2);
  });
  it('only lets the host start, then seats humans before bots', () => {
    const { connect } = setup();
    const { host, code } = createRoom(connect);
    const guest = connect();
    guest.say({ t: 'join', v: PROTOCOL_VERSION, code, name: 'guest', vehicle: 'goliath' });
    guest.say({ t: 'start' });
    expect(guest.peer.last('error')?.reason).toBe('not-host');
    host.say({ t: 'start' });
    const start = guest.peer.last('start')!;
    expect(start.localId).toBe(1);
    expect(host.peer.last('start')!.localId).toBe(0);
    expect(start.drivers.map(d => d.human)).toEqual([true, true, false, false, false, false]);
    expect(start.drivers[1]).toMatchObject({ name: 'GUEST', vehicle: 'goliath' });
    expect(guest.peer.last('snapshot')).toMatchObject({ tick: 0, phase: 'playing', ack: 0 });
    const late = connect();
    late.say({ t: 'join', v: PROTOCOL_VERSION, code, name: 'late', vehicle: 'viper' });
    expect(late.peer.last('error')?.reason).toBe('match-in-progress');
  });
  it('lets the host choose how many bots join', () => {
    const { connect } = setup();
    const { host, code } = createRoom(connect);
    expect(host.peer.last('lobby')!.lobby.bots).toBe(5);
    const guest = connect();
    guest.say({ t: 'join', v: PROTOCOL_VERSION, code, name: 'guest', vehicle: 'goliath' });
    expect(guest.peer.last('lobby')!.lobby.bots).toBe(4);
    guest.say({ t: 'bots', count: 1 });
    expect(guest.peer.last('error')?.reason).toBe('not-host');
    host.say({ t: 'bots', count: 2 });
    expect(guest.peer.last('lobby')!.lobby.bots).toBe(2);
    host.say({ t: 'start' });
    expect(guest.peer.last('start')!.drivers.map(d => d.human)).toEqual([true, true, false, false]);
    host.say({ t: 'bots', count: 0 });
    expect(host.peer.last('error')?.reason).toBe('match-in-progress');
  });
  it('limits bots to free seats and lets a lone host practice without bots', () => {
    const { connect, manager } = setup();
    const { host, code } = createRoom(connect);
    host.say({ t: 'bots', count: 5 });
    host.say({ t: 'bots', count: 0 });
    expect(host.peer.last('lobby')!.lobby.bots).toBe(0);
    host.say({ t: 'start' });
    expect(host.peer.last('start')!.drivers).toEqual([
      { name: 'HOST', vehicle: 'viper', human: true },
    ]);
    const room = manager.rooms.get(code)!;
    for (let i = 0; i < 120; i++) manager.tick();
    expect(room.playing).toBe(true);
  });
  it('plays humans against each other with no bots', () => {
    const { connect } = setup();
    const { host, code } = createRoom(connect);
    host.say({ t: 'bots', count: 0 });
    connect().say({ t: 'join', v: PROTOCOL_VERSION, code, name: 'guest', vehicle: 'viper' });
    host.say({ t: 'start' });
    expect(host.peer.last('start')!.drivers.map(d => d.human)).toEqual([true, true]);
  });
  it('keeps the host bot choice but gives seats to joining players', () => {
    const { connect } = setup();
    const { host, code } = createRoom(connect);
    host.say({ t: 'bots', count: 3 });
    for (let i = 0; i < 3; i++)
      connect().say({ t: 'join', v: PROTOCOL_VERSION, code, name: `p${i}`, vehicle: 'viper' });
    expect(host.peer.last('lobby')!.lobby.bots).toBe(2);
    host.say({ t: 'bots', count: 9 });
    expect(host.peer.last('error')).toMatchObject({ reason: 'bad-request', fatal: true });
  });
  it('applies inputs in order, acknowledges them and snapshots at the configured rate', () => {
    const { connect, manager } = setup();
    const { host } = createRoom(connect);
    host.say({ t: 'start' });
    host.peer.messages = [];
    for (let seq = 1; seq <= 3; seq++)
      host.say({ t: 'input', seq, input: { ...emptyInput(), throttle: 1 } });
    host.say({ t: 'input', seq: 2, input: { ...emptyInput(), throttle: -1 } });
    for (let i = 0; i < 3; i++) manager.tick();
    const snaps = host.peer.messages.filter(m => m.t === 'snapshot');
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ tick: 3, ack: 3 });
    const room = [...manager.rooms.values()][0];
    expect(room.world!.vehicles[0].control.throttle).toBe(1);
  });
  it('holds a small jitter buffer before consuming inputs', () => {
    const { connect, manager } = setup();
    const { host } = createRoom(connect);
    host.say({ t: 'start' });
    const room = [...manager.rooms.values()][0];
    const send = (seq: number) =>
      host.say({ t: 'input', seq, input: { ...emptyInput(), throttle: 1 } });
    send(1);
    send(2);
    manager.tick();
    expect(room.world!.vehicles[0].control.throttle).toBe(0);
    send(3);
    manager.tick();
    expect(room.world!.vehicles[0].control.throttle).toBe(1);
    // Steady arrivals afterwards are consumed one per tick without starving.
    for (let seq = 4; seq <= 30; seq++) {
      send(seq);
      manager.tick();
    }
    // 29 ticks so far; the snapshot at tick 27 acknowledges input 26, one tick behind.
    expect(host.peer.last('snapshot')).toMatchObject({ tick: 27, ack: 26 });
  });
  it('coasts a silent player instead of repeating their input forever', () => {
    const { connect, manager } = setup();
    const { host } = createRoom(connect);
    host.say({ t: 'start' });
    for (let seq = 1; seq <= 3; seq++)
      host.say({
        t: 'input',
        seq,
        input: { ...emptyInput(), throttle: 1, selectedWeapon: 'rocket' },
      });
    const room = [...manager.rooms.values()][0];
    for (let i = 0; i < 10; i++) manager.tick();
    expect(room.world!.vehicles[0].control.throttle).toBe(1);
    for (let i = 0; i < 10; i++) manager.tick();
    expect(room.world!.vehicles[0].control).toMatchObject({
      throttle: 0,
      selectedWeapon: 'rocket',
    });
  });
  it('hands a disconnected player car to a bot and the host role to the next player', () => {
    const { connect, manager } = setup();
    const { host, code } = createRoom(connect);
    const guest = connect();
    guest.say({ t: 'join', v: PROTOCOL_VERSION, code, name: 'guest', vehicle: 'goliath' });
    host.say({ t: 'start' });
    host.conn.closed();
    const room = manager.rooms.get(code)!;
    expect(room.world!.vehicles[0].human).toBe(false);
    expect(guest.peer.last('lobby')!.lobby.players).toEqual([
      { id: 2, name: 'GUEST', vehicle: 'goliath', host: true },
    ]);
    guest.conn.closed();
    expect(manager.rooms.has(code)).toBe(false);
  });
  it('returns to the lobby for a rematch once the match is over', () => {
    const { connect, manager } = setup();
    const { host, code } = createRoom(connect);
    host.say({ t: 'start' });
    const room = manager.rooms.get(code)!;
    room.world!.vehicles.slice(1).forEach(v => (v.dead = true));
    manager.tick();
    expect(host.peer.last('snapshot')).toMatchObject({ phase: 'over', winner: 0 });
    expect(room.playing).toBe(false);
    expect(host.peer.messages.at(-1)?.t).toBe('lobby');
    host.say({ t: 'start' });
    expect(room.playing).toBe(true);
  });
});

describe('connection hygiene', () => {
  it('answers pings', () => {
    const { connect } = setup();
    const c = connect();
    c.say({ t: 'ping', at: 1234.5 });
    expect(c.peer.last('pong')).toEqual({ t: 'pong', at: 1234.5 });
  });
  it('disconnects clients that send garbage', () => {
    const { connect } = setup();
    const c = connect();
    c.conn.receive('{"t":"explode"}');
    expect(c.peer.last('error')).toMatchObject({ reason: 'bad-request', fatal: true });
    expect(c.peer.closedWith?.[0]).toBe(1008);
  });
  it('rate-limits floods but allows a steady 60 Hz input stream', () => {
    const { connect, advance } = setup({ maxMessagesPerSecond: 120 });
    const steady = connect();
    for (let i = 0; i < 600; i++) {
      advance(1000 / 60);
      steady.say({ t: 'ping', at: i });
    }
    expect(steady.peer.last('error')).toBeUndefined();
    const flood = connect();
    for (let i = 0; i < 200; i++) flood.say({ t: 'ping', at: i });
    expect(flood.peer.last('error')).toMatchObject({ reason: 'rate-limit', fatal: true });
  });
  it('closes every room with a restart notice on shutdown', () => {
    const { connect, manager } = setup();
    const { host } = createRoom(connect);
    host.say({ t: 'start' });
    manager.shutdown();
    expect(host.peer.last('error')).toMatchObject({ reason: 'server-restarting', fatal: true });
    expect(host.peer.closedWith).toEqual([1012, 'server-restarting']);
    expect(manager.rooms.size).toBe(0);
  });
});
