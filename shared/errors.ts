export class MechaError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly exitCode: number;

  constructor(
    message: string,
    opts: { code: string; statusCode: number; exitCode: number; cause?: unknown },
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = this.constructor.name;
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.exitCode = opts.exitCode;
  }
}

type ErrorOpts = { code: string; statusCode: number; exitCode: number };

export function defError<A extends unknown[]>(
  name: string,
  opts: ErrorOpts,
  msg: (...args: A) => string,
) {
  const arity = msg.length;
  const cls = class extends MechaError {
    constructor(...args: unknown[]) {
      const last = args.length > arity ? args[args.length - 1] : undefined;
      const hasCauseOpt = typeof last === "object" && last !== null && "cause" in (last as Record<string, unknown>);
      const cause = hasCauseOpt ? (last as { cause?: unknown }).cause : undefined;
      const msgArgs = (hasCauseOpt ? args.slice(0, arity) : args.slice(0, arity)) as A;
      super(msg(...msgArgs), { ...opts, cause });
      this.name = name;
    }
  };
  Object.defineProperty(cls, "name", { value: name });
  return cls as { new (...args: [...A] | [...A, { cause?: unknown }]): MechaError };
}

// --- Name/Config errors ---
export const InvalidNameError = defError<[string]>(
  "InvalidNameError",
  { code: "INVALID_NAME", statusCode: 400, exitCode: 1 },
  (input) => `Invalid name: "${input}" (must be lowercase, alphanumeric, hyphens, 1-32 chars)`,
);

export const ConfigValidationError = defError<[string]>(
  "ConfigValidationError",
  { code: "CONFIG_VALIDATION_ERROR", statusCode: 400, exitCode: 1 },
  (detail) => `Invalid bot config: ${detail}`,
);

// --- Bot lifecycle errors ---
export const BotNotFoundError = defError<[string]>(
  "BotNotFoundError",
  { code: "BOT_NOT_FOUND", statusCode: 404, exitCode: 1 },
  (name) => `bot "${name}" not found`,
);

export const BotAlreadyExistsError = defError<[string]>(
  "BotAlreadyExistsError",
  { code: "BOT_ALREADY_EXISTS", statusCode: 409, exitCode: 1 },
  (name) => `bot "${name}" already exists`,
);

export const BotNotRunningError = defError<[string]>(
  "BotNotRunningError",
  { code: "BOT_NOT_RUNNING", statusCode: 409, exitCode: 1 },
  (name) => `bot "${name}" is not running`,
);

export const BotAlreadyRunningError = defError<[string]>(
  "BotAlreadyRunningError",
  { code: "BOT_ALREADY_RUNNING", statusCode: 409, exitCode: 1 },
  (name) => `bot "${name}" is already running`,
);

export const BotBusyError = defError<[string]>(
  "BotBusyError",
  { code: "BOT_BUSY", statusCode: 409, exitCode: 1 },
  (name) => `bot "${name}" is busy processing a request`,
);

// --- Auth errors ---
export const AuthProfileNotFoundError = defError<[string]>(
  "AuthProfileNotFoundError",
  { code: "AUTH_PROFILE_NOT_FOUND", statusCode: 404, exitCode: 1 },
  (name) => `Auth profile "${name}" not found`,
);

export const AuthNotConfiguredError = defError<[]>(
  "AuthNotConfiguredError",
  { code: "AUTH_NOT_CONFIGURED", statusCode: 401, exitCode: 1 },
  () => `No API key configured. Set ANTHROPIC_API_KEY or run: mecha auth add <profile> <key>`,
);

// --- Path errors ---
export const PathNotFoundError = defError<[string]>(
  "PathNotFoundError",
  { code: "PATH_NOT_FOUND", statusCode: 400, exitCode: 1 },
  (path) => `Path not found: "${path}"`,
);

export const PathNotDirectoryError = defError<[string]>(
  "PathNotDirectoryError",
  { code: "PATH_NOT_DIRECTORY", statusCode: 400, exitCode: 1 },
  (path) => `Path is not a directory: "${path}"`,
);

// --- Port errors ---
export const InvalidPortError = defError<[number]>(
  "InvalidPortError",
  { code: "INVALID_PORT", statusCode: 400, exitCode: 1 },
  (port) => `Invalid port: ${port}`,
);

// --- Process errors ---
export const ProcessSpawnError = defError<[string]>(
  "ProcessSpawnError",
  { code: "PROCESS_SPAWN_ERROR", statusCode: 500, exitCode: 2 },
  (reason) => `Failed to spawn bot: ${reason}`,
);

export const ProcessHealthTimeoutError = defError<[string]>(
  "ProcessHealthTimeoutError",
  { code: "PROCESS_HEALTH_TIMEOUT", statusCode: 500, exitCode: 2 },
  (name) => `bot "${name}" failed health check. Check logs with: mecha logs ${name}`,
);

// --- Config errors ---
export const CorruptConfigError = defError<[string]>(
  "CorruptConfigError",
  { code: "CORRUPT_CONFIG", statusCode: 500, exitCode: 1 },
  (file) => `Corrupt ${file} — delete and re-initialize`,
);
