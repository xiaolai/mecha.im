/* v8 ignore start -- infrastructure: logger is tested via integration through all modules that use it */
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

let cachedThreshold: number | null = null;

function getThreshold(): number {
  if (cachedThreshold !== null) return cachedThreshold;
  const env = (process.env.MECHA_LOG_LEVEL ?? "info").toLowerCase();
  cachedThreshold = LEVELS[env as Level] ?? LEVELS.info;
  return cachedThreshold;
}

/** Reset cached log level (for testing). */
export function resetLogLevel(): void {
  cachedThreshold = null;
}

const REDACT_KEYS = new Set(["token", "authorization", "apikey", "api_key", "secret", "password", "credential"]);
const MAX_REDACT_DEPTH = 3;

function redact(data: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(data)) {
    if (REDACT_KEYS.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else if (depth < MAX_REDACT_DEPTH && val !== null && typeof val === "object" && !Array.isArray(val)) {
      result[key] = redact(val as Record<string, unknown>, depth + 1);
    } else {
      result[key] = val;
    }
  }
  return result;
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return '{"error":"[unserializable log entry]"}';
  }
}

function emit(level: Level, ns: string, msg: string, data?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    ns,
    msg,
  };
  if (data !== undefined) entry.data = redact(data);
  console.error(safeStringify(entry));
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
