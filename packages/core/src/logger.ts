/* v8 ignore start -- infrastructure: logger is tested via integration through all modules that use it */
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

function getThreshold(): number {
  const env = (process.env.MECHA_LOG_LEVEL ?? "info").toLowerCase();
  return LEVELS[env as Level] ?? LEVELS.info;
}

function emit(level: Level, ns: string, msg: string, data?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    ns,
    msg,
  };
  if (data !== undefined) entry.data = data;
  console.error(JSON.stringify(entry));
}

/**
 * Create a structured JSON logger that writes to stderr.
 * Respects MECHA_LOG_LEVEL env var (debug | info | warn | error).
 */
export function createLogger(namespace: string): Logger {
  return {
    debug(msg, data) {
      if (getThreshold() <= LEVELS.debug) emit("debug", namespace, msg, data);
    },
    info(msg, data) {
      if (getThreshold() <= LEVELS.info) emit("info", namespace, msg, data);
    },
    warn(msg, data) {
      if (getThreshold() <= LEVELS.warn) emit("warn", namespace, msg, data);
    },
    error(msg, data) {
      if (getThreshold() <= LEVELS.error) emit("error", namespace, msg, data);
    },
  };
}
/* v8 ignore stop */
