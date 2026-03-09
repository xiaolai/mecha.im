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

/** Error thrown when a bot name contains invalid characters. */
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
/** Error thrown when a mesh address format is invalid. */
export const InvalidAddressError = defError<[string]>(
  "InvalidAddressError",
  { code: "INVALID_ADDRESS", statusCode: 400, exitCode: 1 },
  (input) => `Invalid address: "${input}"`,
);

// --- Config validation errors ---
/** Error thrown when bot config fails validation (e.g. mutually exclusive fields). */
export const ConfigValidationError = defError<[string]>(
  "ConfigValidationError",
  { code: "CONFIG_VALIDATION_ERROR", statusCode: 400, exitCode: 1 },
  (detail) => `Invalid bot config: ${detail}`,
);

// --- Bot lifecycle errors ---
/** Error thrown when a bot with the given name does not exist. */
export const BotNotFoundError = defError<[string]>(
  "BotNotFoundError",
  { code: "BOT_NOT_FOUND", statusCode: 404, exitCode: 1 },
  (name) => `bot "${name}" not found`,
);

/** Error thrown when a bot with the given name already exists. */
export const BotAlreadyExistsError = defError<[string]>(
  "BotAlreadyExistsError",
  { code: "BOT_ALREADY_EXISTS", statusCode: 409, exitCode: 1 },
  (name) => `bot "${name}" already exists`,
);

/** Error thrown when a bot is not in a running state. */
export const BotNotRunningError = defError<[string]>(
  "BotNotRunningError",
  { code: "BOT_NOT_RUNNING", statusCode: 409, exitCode: 1 },
  (name) => `bot "${name}" is not running`,
);

/** Error thrown when attempting to start a bot that is already running. */
export const BotAlreadyRunningError = defError<[string]>(
  "BotAlreadyRunningError",
  { code: "BOT_ALREADY_RUNNING", statusCode: 409, exitCode: 1 },
  (name) => `bot "${name}" is already running`,
);

/** Error thrown when a bot is busy processing another request. */
export const BotBusyError = defError<[string, number]>(
  "BotBusyError",
  { code: "BOT_BUSY", statusCode: 409, exitCode: 1 },
  (name, count) => `bot "${name}" has ${count} active session${count === 1 ? "" : "s"} — use --force to override`,
);

// --- Path errors ---
/** Error thrown when a filesystem path does not exist. */
export const PathNotFoundError = defError<[string]>(
  "PathNotFoundError",
  { code: "PATH_NOT_FOUND", statusCode: 400, exitCode: 1 },
  (path) => `Path not found: "${path}"`,
);

/** Error thrown when a path is not a valid directory. */
export const PathNotDirectoryError = defError<[string]>(
  "PathNotDirectoryError",
  { code: "PATH_NOT_DIRECTORY", statusCode: 400, exitCode: 1 },
  (path) => `Path is not a directory: "${path}"`,
);

// --- Port errors ---
/** Error thrown when a port is already in use by another process. */
export const PortConflictError = defError<[number]>(
  "PortConflictError",
  { code: "PORT_CONFLICT", statusCode: 409, exitCode: 1 },
  (port) => `Port ${port} is already in use`,
);

/** Error thrown when a port number is invalid. */
export const InvalidPortError = defError<[number]>(
  "InvalidPortError",
  { code: "INVALID_PORT", statusCode: 400, exitCode: 1 },
  (port) => `Invalid port: ${port}`,
);

// --- Session errors ---
/** Error thrown when a session ID does not exist. */
export const SessionNotFoundError = defError<[string]>(
  "SessionNotFoundError",
  { code: "SESSION_NOT_FOUND", statusCode: 404, exitCode: 1 },
  (id) => `Session "${id}" not found`,
);

/** Error thrown when a session is busy with another operation. */
export const SessionBusyError = defError<[string]>(
  "SessionBusyError",
  { code: "SESSION_BUSY", statusCode: 409, exitCode: 1 },
  (id) => `Session "${id}" is busy`,
);

// --- Auth errors ---
/** Error thrown when an auth profile name does not exist. */
export const AuthProfileNotFoundError = defError<[string]>(
  "AuthProfileNotFoundError",
  { code: "AUTH_PROFILE_NOT_FOUND", statusCode: 404, exitCode: 1 },
  (name) => `Auth profile "${name}" not found`,
);

/** Error thrown when an auth token has expired. */
export const AuthTokenExpiredError = defError<[string, string]>(
  "AuthTokenExpiredError",
  { code: "AUTH_TOKEN_EXPIRED", statusCode: 401, exitCode: 1 },
  (profile, date) => `Auth token "${profile}" expired on ${date}`,
);

/** Error thrown when an auth token fails validation. */
export const AuthTokenInvalidError = defError<[string]>(
  "AuthTokenInvalidError",
  { code: "AUTH_TOKEN_INVALID", statusCode: 401, exitCode: 1 },
  (profile) => `Auth token "${profile}" is invalid`,
);

// --- Process errors ---
/** Error thrown when a bot process fails to spawn. */
export const ProcessSpawnError = defError<[string]>(
  "ProcessSpawnError",
  { code: "PROCESS_SPAWN_ERROR", statusCode: 500, exitCode: 2 },
  (reason) => `Failed to spawn bot: ${reason}`,
);

/** Error thrown when a process health check times out. */
export const ProcessHealthTimeoutError = defError<[string]>(
  "ProcessHealthTimeoutError",
  { code: "PROCESS_HEALTH_TIMEOUT", statusCode: 500, exitCode: 2 },
  (name) => `bot "${name}" failed health check. Check logs with: mecha logs ${name}`,
);

// --- ACL errors (Phase 3) ---
/** Error thrown when an ACL check denies access. */
export const AclDeniedError = defError<[string, string, string]>(
  "AclDeniedError",
  { code: "ACL_DENIED", statusCode: 403, exitCode: 3 },
  (source, capability, target) => `Access denied: ${source} cannot ${capability} ${target}`,
);

// --- Identity errors (Phase 3) ---
/** Error thrown when a node identity is not found. */
export const IdentityNotFoundError = defError<[string]>(
  "IdentityNotFoundError",
  { code: "IDENTITY_NOT_FOUND", statusCode: 404, exitCode: 1 },
  (name) => `Identity not found: "${name}"`,
);

/** Error thrown when an ACL capability is invalid. */
export const InvalidCapabilityError = defError<[string]>(
  "InvalidCapabilityError",
  { code: "INVALID_CAPABILITY", statusCode: 400, exitCode: 2 },
  (cap) => `Invalid capability: "${cap}"`,
);

// --- Node errors (Phase 4) ---
/** Error thrown when a mesh node name is not registered. */
export const NodeNotFoundError = defError<[string]>(
  "NodeNotFoundError",
  { code: "NODE_NOT_FOUND", statusCode: 404, exitCode: 1 },
  (name) => `Node "${name}" not found`,
);

/** Error thrown when a node with the given name already exists. */
export const DuplicateNodeError = defError<[string]>(
  "DuplicateNodeError",
  { code: "DUPLICATE_NODE", statusCode: 409, exitCode: 1 },
  (name) => `Node "${name}" already registered`,
);

// --- Auth profile errors ---
/** Error thrown when an auth profile with the given name already exists. */
export const AuthProfileAlreadyExistsError = defError<[string]>(
  "AuthProfileAlreadyExistsError",
  { code: "AUTH_PROFILE_ALREADY_EXISTS", statusCode: 409, exitCode: 1 },
  (name) => `Auth profile "${name}" already exists`,
);

// --- Forwarding errors ---
/** Error thrown when a forwarded request to a remote bot returns an error. */
export const ForwardingError = defError<[number]>(
  "ForwardingError",
  { code: "FORWARDING_ERROR", statusCode: 502, exitCode: 2 },
  (status) => {
    if (status === 401) return `Target returned HTTP 401 — check auth token`;
    if (status === 502 || status === 503) return `Target returned HTTP ${status} — bot may be starting up, retry shortly`;
    return `Target returned HTTP ${status}`;
  },
);

// --- Tool errors ---
/** Error thrown when an MCP tool name is invalid. */
export const InvalidToolNameError = defError<[string]>(
  "InvalidToolNameError",
  { code: "INVALID_TOOL_NAME", statusCode: 400, exitCode: 1 },
  (name) => `Invalid tool name: "${name}"`,
);

// --- Session fetch errors ---
/** Error thrown when fetching session data from a bot fails. */
export const SessionFetchError = defError<[string, number]>(
  "SessionFetchError",
  { code: "SESSION_FETCH_ERROR", statusCode: 502, exitCode: 2 },
  (op, status) => `Failed to ${op} sessions: ${status}`,
);

// --- Chat errors ---
/** Error thrown when a chat request to a bot fails. */
export const ChatRequestError = defError<[number, string]>(
  "ChatRequestError",
  { code: "CHAT_REQUEST_ERROR", statusCode: 502, exitCode: 2 },
  (status, detail) => detail || `Chat request failed: ${status}`,
);

// --- Remote routing errors ---
/** Error thrown when a remote mesh node returns an HTTP error. */
export const RemoteRoutingError = defError<[string, number]>(
  "RemoteRoutingError",
  { code: "REMOTE_ROUTING_ERROR", statusCode: 502, exitCode: 2 },
  (node, status) => `Remote node ${node} returned HTTP ${status}`,
);

// --- Node config errors ---
/** Error thrown when a configuration file is corrupt or unreadable. */
export const CorruptConfigError = defError<[string]>(
  "CorruptConfigError",
  { code: "CORRUPT_CONFIG", statusCode: 500, exitCode: 1 },
  (file) => `Corrupt ${file} — delete and re-initialize`,
);

// --- Port range exhaustion ---
/** Error thrown when no available port exists in the 7700-7799 range. */
export const PortRangeExhaustedError = defError<[number, number]>(
  "PortRangeExhaustedError",
  { code: "PORT_RANGE_EXHAUSTED", statusCode: 503, exitCode: 2 },
  (base, max) => `No available port in range ${base}-${max}`,
);

// --- Group address not supported ---
/** Error thrown when a group address (e.g. +tag) is used where unsupported. */
export const GroupAddressNotSupportedError = defError<[string]>(
  "GroupAddressNotSupportedError",
  { code: "GROUP_ADDRESS_NOT_SUPPORTED", statusCode: 400, exitCode: 1 },
  (input) => `Group addresses are not supported yet: "${input}"`,
);

// --- Schedule errors ---
/** Error thrown when a schedule ID does not exist. */
export const ScheduleNotFoundError = defError<[string]>(
  "ScheduleNotFoundError",
  { code: "SCHEDULE_NOT_FOUND", statusCode: 404, exitCode: 1 },
  (id) => `Schedule "${id}" not found`,
);

/** Error thrown when a schedule with the given ID already exists. */
export const DuplicateScheduleError = defError<[string]>(
  "DuplicateScheduleError",
  { code: "DUPLICATE_SCHEDULE", statusCode: 409, exitCode: 1 },
  (id) => `Schedule "${id}" already exists`,
);

/** Error thrown when a schedule interval is invalid. */
export const InvalidIntervalError = defError<[string]>(
  "InvalidIntervalError",
  { code: "INVALID_INTERVAL", statusCode: 400, exitCode: 1 },
  (interval) => `Invalid interval: "${interval}" (use format like "30s", "5m", "1h"; min 10s, max 24h)`,
);

/** Error thrown when the schedule limit is reached. */
export const ScheduleLimitError = defError<[number]>(
  "ScheduleLimitError",
  { code: "SCHEDULE_LIMIT", statusCode: 409, exitCode: 1 },
  (max) => `Maximum schedules per bot (${max}) reached`,
);

// --- CLI errors ---
/** Error thrown when another mecha CLI instance is already running. */
export const CliAlreadyRunningError = defError<[number]>(
  "CliAlreadyRunningError",
  { code: "CLI_ALREADY_RUNNING", statusCode: 409, exitCode: 1 },
  (pid) => `Another mecha CLI is already running (pid ${pid})`,
);

// --- Connectivity errors (Phase 6) ---
/** Error thrown when a mesh connection attempt fails. */
export const ConnectError = defError<[string]>(
  "ConnectError",
  { code: "CONNECT_ERROR", statusCode: 503, exitCode: 1 },
  (reason) => `Connection failed: ${reason}`,
);

/** Error thrown when a mesh invite code is invalid. */
export const InvalidInviteError = defError<[string]>(
  "InvalidInviteError",
  { code: "INVALID_INVITE", statusCode: 400, exitCode: 1 },
  (reason) => `Invalid invite: ${reason}`,
);

/** Error thrown when a mesh handshake fails. */
export const HandshakeError = defError<[string]>(
  "HandshakeError",
  { code: "HANDSHAKE_ERROR", statusCode: 502, exitCode: 1 },
  (reason) => `Handshake failed: ${reason}`,
);

/** Error thrown when a mesh peer is offline. */
export const PeerOfflineError = defError<[string]>(
  "PeerOfflineError",
  { code: "PEER_OFFLINE", statusCode: 503, exitCode: 1 },
  (name) => `Peer "${name}" is offline`,
);

/** Error thrown when rendezvous signaling fails. */
export const RendezvousError = defError<[string]>(
  "RendezvousError",
  { code: "RENDEZVOUS_ERROR", statusCode: 502, exitCode: 1 },
  (reason) => `Rendezvous server error: ${reason}`,
);

// --- Meter errors ---
/** Error thrown when the meter proxy is already running. */
export const MeterProxyAlreadyRunningError = defError<[number]>(
  "MeterProxyAlreadyRunningError",
  { code: "METER_PROXY_ALREADY_RUNNING", statusCode: 409, exitCode: 1 },
  (pid) => `Metering proxy already running (pid ${pid})`,
);

/** Error thrown when the meter proxy is not running. */
export const MeterProxyNotRunningError = defError<[]>(
  "MeterProxyNotRunningError",
  { code: "METER_PROXY_NOT_RUNNING", statusCode: 409, exitCode: 1 },
  () => "Metering proxy is not running",
);

/** Error thrown when metering is required but the proxy is not configured. */
export const MeterProxyRequiredError = defError<[]>(
  "MeterProxyRequiredError",
  { code: "METER_PROXY_REQUIRED", statusCode: 503, exitCode: 2 },
  () => "Metering proxy required but not running. Start with: mecha meter start",
);

