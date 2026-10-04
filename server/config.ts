import { LOG_LEVELS, type LogLevel } from './log';

export interface ServerConfig {
  production: boolean;
  port: number;
  allowedOrigins: string[];
  maxRooms: number;
  snapshotHz: number;
  maxMessagesPerSecond: number;
  logLevel: LogLevel;
  shutdownGraceMs: number;
  lagMs: number;
  jitterMs: number;
}

export class ConfigError extends Error {}

const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];
const ORIGIN_PATTERN = /^https?:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/;

type Env = Record<string, string | undefined>;

function integer(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new ConfigError(`${key} must be an integer from ${min} to ${max}; got "${raw}".`);
  return value;
}

function origins(env: Env, production: boolean): string[] {
  const raw = env.ALLOWED_ORIGINS?.trim();
  if (!raw) {
    if (production)
      throw new ConfigError(
        'ALLOWED_ORIGINS is required in production, e.g. https://wreckyard.vercel.app.',
      );
    return DEV_ORIGINS;
  }
  const list = raw
    .split(',')
    .map(origin => origin.trim().toLowerCase().replace(/\/+$/, ''))
    .filter(Boolean);
  for (const origin of list)
    if (origin !== '*' && !ORIGIN_PATTERN.test(origin))
      throw new ConfigError(
        `ALLOWED_ORIGINS entry "${origin}" must look like https://host[:port], https://*.domain or *.`,
      );
  return list;
}

/** Read every setting once at startup; invalid values stop the process with a clear message. */
export function loadConfig(env: Env): ServerConfig {
  const production = env.NODE_ENV === 'production';
  const logLevel = (env.LOG_LEVEL?.trim().toLowerCase() || 'info') as LogLevel;
  if (!LOG_LEVELS.includes(logLevel))
    throw new ConfigError(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}.`);
  const lagMs = integer(env, 'LAG_MS', 0, 0, 2000);
  const jitterMs = integer(env, 'JITTER_MS', 0, 0, 2000);
  if (production && (lagMs || jitterMs))
    throw new ConfigError(
      'LAG_MS and JITTER_MS are for local testing and must be 0 in production.',
    );
  return {
    production,
    port: integer(env, 'PORT', 8787, 0, 65535),
    allowedOrigins: origins(env, production),
    maxRooms: integer(env, 'MAX_ROOMS', 50, 1, 10000),
    snapshotHz: integer(env, 'SNAPSHOT_HZ', 20, 1, 60),
    maxMessagesPerSecond: integer(env, 'MAX_MSG_PER_SEC', 120, 70, 10000),
    logLevel,
    shutdownGraceMs: integer(env, 'SHUTDOWN_GRACE_MS', 5000, 0, 60000),
    lagMs,
    jitterMs,
  };
}

/**
 * Exact origins match exactly; `https://*.example.app` matches one subdomain label, so
 * `https://my-branch.example.app` passes but `https://example.app` does not.
 */
export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (allowed.includes('*')) return true;
  if (!origin) return false;
  const candidate = origin.toLowerCase();
  return allowed.some(pattern => {
    if (!pattern.includes('*')) return pattern === candidate;
    const [scheme, host] = pattern.split('://*.');
    const prefix = `${scheme}://`;
    if (!candidate.startsWith(prefix) || !candidate.endsWith(`.${host}`)) return false;
    const label = candidate.slice(prefix.length, -host.length - 1);
    return /^[a-z0-9-]+$/.test(label);
  });
}
