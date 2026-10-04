export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

type Fields = Record<string, unknown>;
export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(fields: Fields): Logger;
}

/** One JSON object per line on stdout; the platform collects and routes the stream. */
export function createLogger(
  level: LogLevel = 'info',
  write: (line: string) => void = line => process.stdout.write(`${line}\n`),
  base: Fields = {},
): Logger {
  const threshold = LOG_LEVELS.indexOf(level);
  const emit = (at: LogLevel, msg: string, fields?: Fields) => {
    if (LOG_LEVELS.indexOf(at) < threshold) return;
    write(JSON.stringify({ time: new Date().toISOString(), level: at, msg, ...base, ...fields }));
  };
  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: fields => createLogger(level, write, { ...base, ...fields }),
  };
}

export const silentLogger: Logger = createLogger('error', () => {});
