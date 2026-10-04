// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '../src/net/protocol';
import { createApp, type App } from '../server/app';
import { loadConfig } from '../server/config';
import { silentLogger } from '../server/log';

const ORIGIN = 'http://localhost:5173';
let app: App | undefined;

async function start(env: Record<string, string> = {}): Promise<number> {
  app = createApp(loadConfig({ WRECKYARD_SHUTDOWN_GRACE_MS: '1000', ...env }), silentLogger);
  return app.listen(0, '127.0.0.1');
}

function open(port: number, origin = ORIGIN, path = '/ws'): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { origin });
    ws.once('open', () => resolve(ws));
    ws.once('unexpected-response', (_req, res) => reject(new Error(String(res.statusCode))));
    ws.once('error', reject);
  });
}

function next(ws: WebSocket, t: ServerMessage['t']): Promise<ServerMessage> {
  return new Promise(resolve => {
    const listener = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.t !== t) return;
      ws.off('message', listener);
      resolve(msg);
    };
    ws.on('message', listener);
  });
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('server http surface', () => {
  it('reports health for the platform probe', async () => {
    const port = await start();
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ ok: true, rooms: 0, players: 0 });
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
  });
  it('accepts allowed origins and refuses others or wrong paths', async () => {
    const port = await start();
    const ws = await open(port);
    ws.close();
    await expect(open(port, 'https://evil.example')).rejects.toThrow('403');
    await expect(open(port, ORIGIN, '/other')).rejects.toThrow('404');
  });
  it('plays a room end to end over a real socket', async () => {
    const port = await start();
    const host = await open(port);
    const lobby = next(host, 'lobby');
    host.send(JSON.stringify({ t: 'create', v: PROTOCOL_VERSION, name: 'ace', vehicle: 'viper' }));
    const { lobby: state } = (await lobby) as Extract<ServerMessage, { t: 'lobby' }>;
    expect(state.players[0]).toMatchObject({ name: 'ACE', host: true });
    const started = next(host, 'start');
    const snapshot = next(host, 'snapshot');
    host.send(JSON.stringify({ t: 'start' }));
    expect(await started).toMatchObject({ localId: 0, snapshotHz: 20 });
    expect(await snapshot).toMatchObject({ phase: 'playing' });
    // Three inputs fill the server's jitter buffer so it starts consuming them.
    for (let seq = 1; seq <= 3; seq++)
      host.send(JSON.stringify({ t: 'input', seq, input: { throttle: 1 } }));
    let acked: ServerMessage;
    do acked = await next(host, 'snapshot');
    while ((acked as Extract<ServerMessage, { t: 'snapshot' }>).ack < 1);
    host.close();
  });
  it('notifies connected players and refuses new work during shutdown', async () => {
    const port = await start();
    const ws = await open(port);
    const created = next(ws, 'lobby');
    ws.send(JSON.stringify({ t: 'create', v: PROTOCOL_VERSION, name: 'ace', vehicle: 'viper' }));
    await created;
    const notice = next(ws, 'error');
    const closed = new Promise<number>(resolve => ws.once('close', code => resolve(code)));
    const closing = app!.close();
    expect(await notice).toMatchObject({ reason: 'server-restarting', fatal: true });
    expect(await closed).toBe(1012);
    await closing;
  });
});
