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
    opts: { code: string; statusCode: number; exitCode: number; cause?: unknown },
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
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
  const arity = msg.length;
  const cls = class extends MechaError {
    constructor(...args: [...A] | [...A, { cause?: unknown }]) {
      // Only treat the last arg as cause-opts when there's an extra argument
      // beyond the message function's arity AND it's a plain object with "cause".
      // This avoids misclassifying legitimate object args (all current factories
      // use string/number args, so any trailing object is unambiguously cause-opts).
      const last = args.length > arity ? args[args.length - 1] : undefined;
      const hasCauseOpt = typeof last === "object" && last !== null && "cause" in last;
      const cause = hasCauseOpt ? (last as { cause?: unknown }).cause : undefined;
      const msgArgs = (hasCauseOpt ? args.slice(0, -1) : args) as unknown as A;
      super(msg(...msgArgs), { ...opts, cause });
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

// --- Node errors (Phase 4) ---
export const NodeNotFoundError = defError<[string]>(
  "NodeNotFoundError",
  { code: "NODE_NOT_FOUND", statusCode: 404, exitCode: 1 },
  (name) => `Node "${name}" not found`,
);

export const DuplicateNodeError = defError<[string]>(
  "DuplicateNodeError",
  { code: "DUPLICATE_NODE", statusCode: 409, exitCode: 1 },
  (name) => `Node "${name}" already registered`,
);

// --- Auth profile errors ---
export const AuthProfileAlreadyExistsError = defError<[string]>(
  "AuthProfileAlreadyExistsError",
  { code: "AUTH_PROFILE_ALREADY_EXISTS", statusCode: 409, exitCode: 1 },
  (name) => `Auth profile "${name}" already exists`,
);

// --- Forwarding errors ---
export const ForwardingError = defError<[number]>(
  "ForwardingError",
  { code: "FORWARDING_ERROR", statusCode: 502, exitCode: 2 },
  (status) => `Target returned HTTP ${status}`,
);

// --- Tool errors ---
export const InvalidToolNameError = defError<[string]>(
  "InvalidToolNameError",
  { code: "INVALID_TOOL_NAME", statusCode: 400, exitCode: 1 },
  (name) => `Invalid tool name: "${name}"`,
);

// --- Session fetch errors ---
export const SessionFetchError = defError<[string, number]>(
  "SessionFetchError",
  { code: "SESSION_FETCH_ERROR", statusCode: 502, exitCode: 2 },
  (op, status) => `Failed to ${op} sessions: ${status}`,
);

// --- Chat errors ---
export const ChatRequestError = defError<[number, string]>(
  "ChatRequestError",
  { code: "CHAT_REQUEST_ERROR", statusCode: 502, exitCode: 2 },
  (status, detail) => detail || `Chat request failed: ${status}`,
);

// --- Remote routing errors ---
export const RemoteRoutingError = defError<[string, number]>(
  "RemoteRoutingError",
  { code: "REMOTE_ROUTING_ERROR", statusCode: 502, exitCode: 2 },
  (node, status) => `Remote node ${node} returned HTTP ${status}`,
);

// --- Node config errors ---
export const CorruptConfigError = defError<[string]>(
  "CorruptConfigError",
  { code: "CORRUPT_CONFIG", statusCode: 500, exitCode: 1 },
  (file) => `Corrupt ${file} — delete and re-initialize`,
);

// --- Port range exhaustion ---
export const PortRangeExhaustedError = defError<[number, number]>(
  "PortRangeExhaustedError",
  { code: "PORT_RANGE_EXHAUSTED", statusCode: 503, exitCode: 2 },
  (base, max) => `No available port in range ${base}-${max}`,
);

// --- Group address not supported ---
export const GroupAddressNotSupportedError = defError<[string]>(
  "GroupAddressNotSupportedError",
  { code: "GROUP_ADDRESS_NOT_SUPPORTED", statusCode: 400, exitCode: 1 },
  (input) => `Group addresses are not supported yet: "${input}"`,
);

// --- Schedule errors ---
export const ScheduleNotFoundError = defError<[string]>(
  "ScheduleNotFoundError",
  { code: "SCHEDULE_NOT_FOUND", statusCode: 404, exitCode: 1 },
  (id) => `Schedule "${id}" not found`,
);

export const DuplicateScheduleError = defError<[string]>(
  "DuplicateScheduleError",
  { code: "DUPLICATE_SCHEDULE", statusCode: 409, exitCode: 1 },
  (id) => `Schedule "${id}" already exists`,
);

export const InvalidIntervalError = defError<[string]>(
  "InvalidIntervalError",
  { code: "INVALID_INTERVAL", statusCode: 400, exitCode: 1 },
  (interval) => `Invalid interval: "${interval}" (use format like "30s", "5m", "1h"; min 10s, max 24h)`,
);

// --- CLI errors ---
export const CliAlreadyRunningError = defError<[number]>(
  "CliAlreadyRunningError",
  { code: "CLI_ALREADY_RUNNING", statusCode: 409, exitCode: 1 },
  (pid) => `Another mecha CLI is already running (pid ${pid})`,
);

// --- Connectivity errors (Phase 6) ---
export const ConnectError = defError<[string]>(
  "ConnectError",
  { code: "CONNECT_ERROR", statusCode: 503, exitCode: 1 },
  (reason) => `Connection failed: ${reason}`,
);

export const InvalidInviteError = defError<[string]>(
  "InvalidInviteError",
  { code: "INVALID_INVITE", statusCode: 400, exitCode: 1 },
  (reason) => `Invalid invite: ${reason}`,
);

export const HandshakeError = defError<[string]>(
  "HandshakeError",
  { code: "HANDSHAKE_ERROR", statusCode: 502, exitCode: 1 },
  (reason) => `Handshake failed: ${reason}`,
);

export const PeerOfflineError = defError<[string]>(
  "PeerOfflineError",
  { code: "PEER_OFFLINE", statusCode: 503, exitCode: 1 },
  (name) => `Peer "${name}" is offline`,
);

export const RendezvousError = defError<[string]>(
  "RendezvousError",
  { code: "RENDEZVOUS_ERROR", statusCode: 502, exitCode: 1 },
  (reason) => `Rendezvous server error: ${reason}`,
);

// --- Meter errors ---
export const MeterProxyAlreadyRunningError = defError<[number]>(
  "MeterProxyAlreadyRunningError",
  { code: "METER_PROXY_ALREADY_RUNNING", statusCode: 409, exitCode: 1 },
  (pid) => `Metering proxy already running (pid ${pid})`,
);

export const MeterProxyNotRunningError = defError<[]>(
  "MeterProxyNotRunningError",
  { code: "METER_PROXY_NOT_RUNNING", statusCode: 409, exitCode: 1 },
  () => "Metering proxy is not running",
);

export const MeterProxyRequiredError = defError<[]>(
  "MeterProxyRequiredError",
  { code: "METER_PROXY_REQUIRED", statusCode: 503, exitCode: 2 },
  () => "Metering proxy required but not running. Start with: mecha meter start",
);

