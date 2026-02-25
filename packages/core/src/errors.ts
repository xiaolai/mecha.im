/**
 * Base error class for all mecha errors.
 * Carries HTTP status code and CLI exit code for consistent error handling.
 */
export class MechaError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly exitCode: number;

  constructor(
    message: string,
    opts: { code: string; statusCode: number; exitCode: number },
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.exitCode = opts.exitCode;
  }
}

export class InvalidNameError extends MechaError {
  constructor(input: string) {
    super(
      `Invalid name: "${input}" (must be lowercase, alphanumeric, hyphens)`,
      { code: "INVALID_NAME", statusCode: 400, exitCode: 1 },
    );
  }
}

// --- Domain errors (factory pattern) ---

type ErrorOpts = { code: string; statusCode: number; exitCode: number };

function defError<A extends unknown[]>(
  name: string,
  opts: ErrorOpts,
  msg: (...args: A) => string,
) {
  const cls = class extends MechaError {
    constructor(...args: A) {
      super(msg(...args), opts);
      this.name = name;
    }
  };
  Object.defineProperty(cls, "name", { value: name });
  return cls;
}

// --- Address errors ---
export const InvalidAddressError = defError<[string]>(
  "InvalidAddressError",
  { code: "INVALID_ADDRESS", statusCode: 400, exitCode: 1 },
  (input) => `Invalid address: "${input}"`,
);

// --- CASA lifecycle errors ---
export const CasaNotFoundError = defError<[string]>(
  "CasaNotFoundError",
  { code: "CASA_NOT_FOUND", statusCode: 404, exitCode: 1 },
  (name) => `CASA "${name}" not found`,
);

export const CasaAlreadyExistsError = defError<[string]>(
  "CasaAlreadyExistsError",
  { code: "CASA_ALREADY_EXISTS", statusCode: 409, exitCode: 1 },
  (name) => `CASA "${name}" already exists`,
);

export const CasaNotRunningError = defError<[string]>(
  "CasaNotRunningError",
  { code: "CASA_NOT_RUNNING", statusCode: 409, exitCode: 1 },
  (name) => `CASA "${name}" is not running`,
);

export const CasaAlreadyRunningError = defError<[string]>(
  "CasaAlreadyRunningError",
  { code: "CASA_ALREADY_RUNNING", statusCode: 409, exitCode: 1 },
  (name) => `CASA "${name}" is already running`,
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
export const PortConflictError = defError<[number]>(
  "PortConflictError",
  { code: "PORT_CONFLICT", statusCode: 409, exitCode: 1 },
  (port) => `Port ${port} is already in use`,
);

export const InvalidPortError = defError<[number]>(
  "InvalidPortError",
  { code: "INVALID_PORT", statusCode: 400, exitCode: 1 },
  (port) => `Invalid port: ${port}`,
);

// --- Session errors ---
export const SessionNotFoundError = defError<[string]>(
  "SessionNotFoundError",
  { code: "SESSION_NOT_FOUND", statusCode: 404, exitCode: 1 },
  (id) => `Session "${id}" not found`,
);

export const SessionBusyError = defError<[string]>(
  "SessionBusyError",
  { code: "SESSION_BUSY", statusCode: 409, exitCode: 1 },
  (id) => `Session "${id}" is busy`,
);

// --- Auth errors ---
export const AuthProfileNotFoundError = defError<[string]>(
  "AuthProfileNotFoundError",
  { code: "AUTH_PROFILE_NOT_FOUND", statusCode: 404, exitCode: 1 },
  (name) => `Auth profile "${name}" not found`,
);

export const AuthTokenExpiredError = defError<[string, string]>(
  "AuthTokenExpiredError",
  { code: "AUTH_TOKEN_EXPIRED", statusCode: 401, exitCode: 1 },
  (profile, date) => `Auth token "${profile}" expired on ${date}`,
);

export const AuthTokenInvalidError = defError<[string]>(
  "AuthTokenInvalidError",
  { code: "AUTH_TOKEN_INVALID", statusCode: 401, exitCode: 1 },
  (profile) => `Auth token "${profile}" is invalid`,
);

// --- Process errors ---
export const ProcessSpawnError = defError<[string]>(
  "ProcessSpawnError",
  { code: "PROCESS_SPAWN_ERROR", statusCode: 500, exitCode: 2 },
  (reason) => `Failed to spawn CASA: ${reason}`,
);

export const ProcessHealthTimeoutError = defError<[string]>(
  "ProcessHealthTimeoutError",
  { code: "PROCESS_HEALTH_TIMEOUT", statusCode: 500, exitCode: 2 },
  (name) => `CASA "${name}" failed health check`,
);

// --- ACL errors (Phase 3) ---
export const AclDeniedError = defError<[string, string, string]>(
  "AclDeniedError",
  { code: "ACL_DENIED", statusCode: 403, exitCode: 3 },
  (source, capability, target) => `Access denied: ${source} cannot ${capability} ${target}`,
);

// --- Identity errors (Phase 3) ---
export const IdentityNotFoundError = defError<[string]>(
  "IdentityNotFoundError",
  { code: "IDENTITY_NOT_FOUND", statusCode: 404, exitCode: 1 },
  (name) => `Identity not found: "${name}"`,
);

export const InvalidCapabilityError = defError<[string]>(
  "InvalidCapabilityError",
  { code: "INVALID_CAPABILITY", statusCode: 400, exitCode: 2 },
  (cap) => `Invalid capability: "${cap}"`,
);
