import { redact } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

/**
 * Structured logger. `event` is a stable, dot-separated name (e.g. `task.transition`) so logs
 * can be queried; details go in `fields`.
 */
export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface JsonLoggerOptions {
  service: string;
  level?: LogLevel;
  bindings?: LogFields;
  /** Where each JSON line goes. Defaults to stdout. */
  sink?: (line: string) => void;
  now?: () => Date;
}

/** Dependency-free JSON-lines logger. Every field passes through `redact` before output. */
export function createJsonLogger(options: JsonLoggerOptions): Logger {
  const minLevel = LEVEL_ORDER[options.level ?? 'info'];
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());
  const bindings = options.bindings ?? {};

  const write = (level: LogLevel, event: string, fields: LogFields = {}) => {
    if (LEVEL_ORDER[level] < minLevel) return;
    const record = redact({ ...bindings, ...fields }) as LogFields;
    sink(
      JSON.stringify({
        time: now().toISOString(),
        level,
        service: options.service,
        event,
        ...record,
      }),
    );
  };

  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    child: (childBindings) =>
      createJsonLogger({ ...options, bindings: { ...bindings, ...childBindings } }),
  };
}
