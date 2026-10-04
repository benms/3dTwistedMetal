import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, originAllowed } from '../server/config';

describe('server configuration', () => {
  it('uses development defaults when nothing is set', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      production: false,
      port: 8787,
      maxRooms: 50,
      snapshotHz: 20,
      maxMessagesPerSecond: 120,
      logLevel: 'info',
      shutdownGraceMs: 5000,
      lagMs: 0,
      jitterMs: 0,
    });
    expect(config.allowedOrigins).toContain('http://localhost:5173');
  });
  it('reads the platform port and a list of origins', () => {
    const config = loadConfig({
      PORT: '10000',
      WRECKYARD_ALLOWED_ORIGINS: ' https://wreckyard.vercel.app/ , https://*.vercel.app',
      WRECKYARD_LOG_LEVEL: 'WARN',
    });
    expect(config.port).toBe(10000);
    expect(config.logLevel).toBe('warn');
    expect(config.allowedOrigins).toEqual(['https://wreckyard.vercel.app', 'https://*.vercel.app']);
  });
  it('rejects invalid values with a message naming the variable', () => {
    for (const [env, name] of [
      [{ PORT: 'eighty' }, 'PORT'],
      [{ PORT: '70000' }, 'PORT'],
      [{ WRECKYARD_SNAPSHOT_HZ: '0' }, 'WRECKYARD_SNAPSHOT_HZ'],
      [{ WRECKYARD_MAX_MSG_PER_SEC: '30' }, 'WRECKYARD_MAX_MSG_PER_SEC'],
      [{ WRECKYARD_LOG_LEVEL: 'loud' }, 'WRECKYARD_LOG_LEVEL'],
      [{ WRECKYARD_ALLOWED_ORIGINS: 'wreckyard.vercel.app' }, 'WRECKYARD_ALLOWED_ORIGINS'],
    ] as const) {
      expect(() => loadConfig(env)).toThrow(ConfigError);
      expect(() => loadConfig(env)).toThrow(name);
    }
  });
  it('requires explicit origins and no simulated lag in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('WRECKYARD_ALLOWED_ORIGINS');
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        WRECKYARD_ALLOWED_ORIGINS: 'https://a.app',
        WRECKYARD_LAG_MS: '100',
      }),
    ).toThrow('WRECKYARD_LAG_MS');
    expect(
      loadConfig({ NODE_ENV: 'production', WRECKYARD_ALLOWED_ORIGINS: 'https://a.app' }).production,
    ).toBe(true);
  });
  it('reads only WRECKYARD_-prefixed settings and explains the old origin name', () => {
    const config = loadConfig({
      ALLOWED_ORIGINS: 'https://old.app',
      MAX_ROOMS: '3',
      LOG_LEVEL: 'debug',
    });
    expect(config.allowedOrigins).not.toContain('https://old.app');
    expect(config).toMatchObject({ maxRooms: 50, logLevel: 'info' });
    expect(() =>
      loadConfig({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://old.app' }),
    ).toThrow(
      'WRECKYARD_ALLOWED_ORIGINS is required in production, e.g. https://wreckyard.vercel.app. ALLOWED_ORIGINS is set, but it was renamed',
    );
  });
});

describe('origin checks', () => {
  const allowed = [
    'https://wreckyard.vercel.app',
    'https://*.preview.app',
    'http://localhost:5173',
  ];
  it('accepts exact matches and single-label wildcard subdomains', () => {
    expect(originAllowed('https://wreckyard.vercel.app', allowed)).toBe(true);
    expect(originAllowed('https://WRECKYARD.vercel.app', allowed)).toBe(true);
    expect(originAllowed('https://feature-x.preview.app', allowed)).toBe(true);
    expect(originAllowed('http://localhost:5173', allowed)).toBe(true);
  });
  it('rejects everything else', () => {
    for (const origin of [
      undefined,
      'null',
      'http://wreckyard.vercel.app',
      'https://wreckyard.vercel.app.evil.com',
      'https://preview.app',
      'https://a.b.preview.app',
      'https://evil.com/.preview.app',
      'http://localhost:5174',
    ])
      expect(originAllowed(origin, allowed)).toBe(false);
  });
  it('allows any origin only when explicitly configured with *', () => {
    expect(originAllowed(undefined, ['*'])).toBe(true);
    expect(originAllowed('https://anything.example', ['*'])).toBe(true);
  });
});
