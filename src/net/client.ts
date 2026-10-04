import { healthUrl } from './endpoint';
import type { ClientMessage, ServerMessage } from './protocol';

export type ConnectionStatus = 'connecting' | 'waking' | 'open';

export interface NetClientHandlers {
  message(msg: ServerMessage): void;
  /** 'waking' means the first attempts failed and we keep retrying a sleeping server. */
  status(status: ConnectionStatus): void;
  /** An established connection dropped without us asking it to. */
  closed(code: number): void;
}

const PING_INTERVAL_MS = 2000;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A WebSocket with JSON framing, wake-up retries and a smoothed round-trip time. */
export class NetClient {
  /** Smoothed round-trip time in milliseconds; 0 until the first pong. */
  rtt = 0;
  private socket?: WebSocket;
  private pingTimer?: ReturnType<typeof setInterval>;
  private cancelled = false;

  constructor(
    private readonly url: string,
    private readonly handlers: NetClientHandlers,
    private readonly createSocket: (url: string) => WebSocket = url => new WebSocket(url),
    private readonly wakeTimeoutMs = 90_000,
  ) {}

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Resolve once open; retries with backoff while a free-tier host spins up. */
  async connect(): Promise<void> {
    if (this.connected) return;
    this.cancelled = false;
    // Poke the health endpoint so a sleeping host starts booting immediately.
    void fetch(healthUrl(this.url), { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
    const deadline = performance.now() + this.wakeTimeoutMs;
    let delay = 1000;
    this.handlers.status('connecting');
    for (;;) {
      try {
        await this.open();
        return;
      } catch {
        if (this.cancelled) throw new Error('cancelled');
        if (performance.now() + delay > deadline) throw new Error('unreachable');
        this.handlers.status('waking');
        await sleep(delay);
        if (this.cancelled) throw new Error('cancelled');
        delay = Math.min(delay * 1.5, 5000);
      }
    }
  }

  send(msg: ClientMessage): void {
    if (this.connected) this.socket!.send(JSON.stringify(msg));
  }

  close(): void {
    this.cancelled = true;
    this.stopPing();
    const socket = this.socket;
    this.socket = undefined;
    socket?.close(1000, 'leaving');
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.createSocket(this.url);
      let opened = false;
      ws.onopen = () => {
        if (this.cancelled) {
          ws.close(1000, 'cancelled');
          return reject(new Error('cancelled'));
        }
        opened = true;
        this.socket = ws;
        this.startPing();
        this.handlers.status('open');
        resolve();
      };
      ws.onclose = event => {
        if (!opened) return reject(new Error(`closed ${event.code}`));
        if (this.socket !== ws) return;
        this.socket = undefined;
        this.stopPing();
        this.handlers.closed(event.code);
      };
      ws.onmessage = event => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        if (msg.t === 'pong') {
          const sample = performance.now() - msg.at;
          this.rtt = this.rtt ? this.rtt * 0.8 + sample * 0.2 : sample;
        } else this.handlers.message(msg);
      };
    });
  }

  private startPing(): void {
    this.stopPing();
    const ping = () => this.send({ t: 'ping', at: performance.now() });
    ping();
    this.pingTimer = setInterval(ping, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }
}
