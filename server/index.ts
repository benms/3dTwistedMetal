import { createApp } from './app';
import { ConfigError, loadConfig } from './config';
import { createLogger } from './log';

function configure() {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    createLogger('error').error('invalid configuration', { error: error.message });
    process.exit(1);
  }
}

const config = configure();
const log = createLogger(config.logLevel);
const app = createApp(config, log);

// Crash-only: an unexpected error ends the process and the platform restarts it.
process.on('uncaughtException', error => {
  log.error('uncaught exception', { error: error.stack ?? String(error) });
  process.exit(1);
});
process.on('unhandledRejection', reason => {
  log.error('unhandled rejection', { error: String(reason) });
  process.exit(1);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    log.info('shutting down', { signal, ...app.manager.stats });
    void app.close().then(() => {
      log.info('stopped');
      process.exit(0);
    });
  });

app.listen(config.port, '0.0.0.0').then(
  port =>
    log.info('listening', {
      port,
      production: config.production,
      allowedOrigins: config.allowedOrigins,
      snapshotHz: config.snapshotHz,
      maxRooms: config.maxRooms,
      ...(config.lagMs || config.jitterMs
        ? { lagMs: config.lagMs, jitterMs: config.jitterMs }
        : {}),
    }),
  error => {
    log.error('could not listen', { port: config.port, error: String(error) });
    process.exit(1);
  },
);
