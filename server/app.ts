import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { originAllowed, type ServerConfig } from './config';
import type { Logger } from './log';
import { startLoop } from './loop';
import type { Peer } from './room';
import { RoomManager, type Connection } from './rooms';

/** Small frames only: the largest client message is an input of well under 1 KiB. */
const MAX_PAYLOAD_BYTES = 4096;
/** Clients ping every 2 s; a socket silent for this long is considered dead. */
const STALE_AFTER_MS = 30_000;

export interface App {
  readonly server: Server;
  readonly manager: RoomManager;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

/** Deliver callbacks after a simulated network delay without reordering them. */
function delayer(lagMs: number, jitterMs: number): (fn: () => void) => void {
  if (!lagMs && !jitterMs) return fn => fn();
  let last = 0;
  return fn => {
    const at = Math.max(last, Date.now() + lagMs + Math.random() * jitterMs);
    last = at;
    setTimeout(fn, at - Date.now());
  };
}

function reject(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function createApp(config: ServerConfig, log: Logger): App {
  const manager = new RoomManager({
    maxRooms: config.maxRooms,
    snapshotHz: config.snapshotHz,
    maxMessagesPerSecond: config.maxMessagesPerSecond,
    log,
  });
  const sockets = new Map<WebSocket, Connection>();
  const started = performance.now();
  let closing: Promise<void> | undefined;
  let stopLoop = () => {};
  let sweep: ReturnType<typeof setInterval> | undefined;

  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
      const body = JSON.stringify({
        ok: !closing,
        uptime: Math.round((performance.now() - started) / 1000),
        ...manager.stats,
      });
      res.writeHead(closing ? 503 : 200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== '/ws') return reject(socket, 404, 'Not Found');
    if (closing) return reject(socket, 503, 'Service Unavailable');
    if (!originAllowed(req.headers.origin, config.allowedOrigins)) {
      log.warn('origin rejected', { origin: req.headers.origin ?? null });
      return reject(socket, 403, 'Forbidden');
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    const outgoing = delayer(config.lagMs, config.jitterMs);
    const incoming = delayer(config.lagMs, config.jitterMs);
    const peer: Peer = {
      send: data =>
        outgoing(() => {
          if (ws.readyState === ws.OPEN) ws.send(data);
        }),
      close: (code, reason) => outgoing(() => ws.close(code, reason)),
    };
    const connection = manager.connect(peer);
    sockets.set(ws, connection);
    log.debug('socket opened', { sockets: sockets.size });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return ws.close(1003, 'text frames only');
      const text = data.toString();
      incoming(() => connection.receive(text));
    });
    ws.on('close', () => {
      sockets.delete(ws);
      connection.closed();
      log.debug('socket closed', { sockets: sockets.size });
    });
    ws.on('error', error => log.debug('socket error', { error: error.message }));
  });

  return {
    server,
    manager,
    listen(port, host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          stopLoop = startLoop(() => manager.tick());
          sweep = setInterval(() => {
            const now = performance.now();
            for (const [ws, connection] of sockets)
              if (now - connection.lastSeen > STALE_AFTER_MS) ws.terminate();
          }, 10_000);
          resolve((server.address() as AddressInfo).port);
        });
      });
    },
    close() {
      closing ??= (async () => {
        stopLoop();
        clearInterval(sweep);
        server.close();
        manager.shutdown();
        const deadline = performance.now() + config.shutdownGraceMs;
        while (sockets.size && performance.now() < deadline)
          await new Promise(resolve => setTimeout(resolve, 25));
        for (const ws of sockets.keys()) ws.terminate();
        wss.close();
        server.closeAllConnections();
      })();
      return closing;
    },
  };
}
