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
      ALLOWED_ORIGINS: ' https://wreckyard.vercel.app/ , https://*.vercel.app',
      LOG_LEVEL: 'WARN',
    });
    expect(config.port).toBe(10000);
    expect(config.logLevel).toBe('warn');
    expect(config.allowedOrigins).toEqual(['https://wreckyard.vercel.app', 'https://*.vercel.app']);
  });
  it('rejects invalid values with a message naming the variable', () => {
    for (const [env, name] of [
      [{ PORT: 'eighty' }, 'PORT'],
      [{ PORT: '70000' }, 'PORT'],
      [{ SNAPSHOT_HZ: '0' }, 'SNAPSHOT_HZ'],
      [{ MAX_MSG_PER_SEC: '30' }, 'MAX_MSG_PER_SEC'],
      [{ LOG_LEVEL: 'loud' }, 'LOG_LEVEL'],
      [{ ALLOWED_ORIGINS: 'wreckyard.vercel.app' }, 'ALLOWED_ORIGINS'],
    ] as const) {
      expect(() => loadConfig(env)).toThrow(ConfigError);
      expect(() => loadConfig(env)).toThrow(name);
    }
  });
  it('requires explicit origins and no simulated lag in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('ALLOWED_ORIGINS');
    expect(() =>
      loadConfig({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://a.app', LAG_MS: '100' }),
    ).toThrow('LAG_MS');
    expect(
      loadConfig({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://a.app' }).production,
    ).toBe(true);
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
