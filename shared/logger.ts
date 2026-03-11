const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

// Keys are matched case-insensitively via k.toLowerCase(), so store only lowercase forms
const REDACT_KEYS = new Set(["token", "key", "secret", "password", "authorization", "api_key", "apikey", "access_token", "auth_key"]);

// Cache log level at startup (avoids env lookup on every emit)
const currentLevel: Level = (() => {
  const env = (process.env.MECHA_LOG_LEVEL ?? "info").toLowerCase();
  return env in LEVELS ? (env as Level) : "info";
})();

function redact(obj: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if (seen.has(obj)) return "[circular]";
  seen.add(obj);
  if (Array.isArray(obj)) return obj.map((v) => redact(v, seen));
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      result[k] = "***";
    } else {
      result[k] = redact(v, seen);
    }
  }
  return result;
}

function emit(level: Level, msg: string, data?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const entry: Record<string, unknown> = {
    level,
    msg,
    ts: new Date().toISOString(),
  };
  if (data) Object.assign(entry, redact(data));
  const line = JSON.stringify(entry);
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const log = {
  debug: (msg: string, data?: Record<string, unknown>) => emit("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => emit("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => emit("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => emit("error", msg, data),
};
