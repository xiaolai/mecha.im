/** Base directory name for mecha config: ~/.mecha */
export const MECHA_DIR = ".mecha";

/** Directory name for managed tool installs: ~/.mecha/tools/ */
export const TOOLS_DIR = "tools";

/** Directory name for auth profiles and credentials: ~/.mecha/auth/ */
export const AUTH_DIR = "auth";

/** Directory name for identity keys: ~/.mecha/identity/ (Phase 3) */
export const IDENTITY_DIR = "identity";

/** Tools that mecha manages in ~/.mecha/tools/ */
export const MANAGED_TOOLS = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
} as const;

/** Operational defaults — single source of truth for all tuning knobs */
export const DEFAULTS = {
  /** First port in the runtime scan range */
  RUNTIME_PORT_BASE: 7700,
  /** Last port in the runtime scan range */
  RUNTIME_PORT_MAX: 7799,
  /** Agent server port (Phase 4) */
  AGENT_PORT: 7660,
  /** MCP HTTP transport port for standalone `mcp serve` (Phase 7).
   *  7680 is reserved for the daemon's embedded MCP server;
   *  7681 is reserved for the embedded rendezvous server. */
  MCP_HTTP_PORT: 7682,
  /** Dashboard port (Phase 7) */
  DASHBOARD_PORT: 3457,
  /** Health check timeout (ms) */
  HEALTH_TIMEOUT_MS: 10_000,
  /** Grace period for SIGTERM before SIGKILL (ms) */
  STOP_GRACE_MS: 5_000,
  /** HTTP forwarding request timeout (ms) */
  FORWARD_TIMEOUT_MS: 60_000,
  /** Max transcript file size to read (bytes) */
  MAX_TRANSCRIPT_BYTES: 10 * 1024 * 1024,
  /** Agent status health-check timeout (ms) */
  AGENT_STATUS_TIMEOUT_MS: 5_000,
  /** Port availability check socket timeout (ms) */
  PORT_CHECK_TIMEOUT_MS: 2_000,
  /** Timeout (ms) for waiting on a stale process to exit after SIGKILL */
  STALE_PROCESS_KILL_TIMEOUT_MS: 3_000,
  /** Default metering proxy port */
  METER_PORT: 7600,
  /** Metering proxy shutdown grace period (ms) */
  METER_STOP_GRACE_MS: 30_000,
  /** Hot counter snapshot interval (ms) */
  METER_SNAPSHOT_INTERVAL_MS: 5_000,
  /** Rollup flush interval (ms) */
  METER_ROLLUP_INTERVAL_MS: 60_000,
  /** bot registry rescan interval (ms) */
  METER_REGISTRY_INTERVAL_MS: 30_000,
  /** Event buffer flush: max events before forced flush */
  METER_EVENT_BUFFER_MAX: 100,
  /** Event buffer flush: max seconds before forced flush */
  METER_EVENT_BUFFER_INTERVAL_MS: 5_000,
  /** Default event retention (days) */
  METER_RETENTION_DAYS: 90,
  /** Embedded rendezvous server port (Phase 6b) */
  EMBEDDED_SERVER_PORT: 7681,
  // --- Connectivity (Phase 6) ---
  /** Rendezvous server URL */
  RENDEZVOUS_URL: "wss://rendezvous.mecha.im",
  /** Relay server URL */
  RELAY_URL: "wss://relay.mecha.im",
  /** Default STUN servers */
  STUN_SERVERS: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] as readonly string[],
  /** STUN discovery timeout (ms) */
  STUN_TIMEOUT_MS: 3_000,
  /** Hole-punch attempt timeout (ms) */
  HOLE_PUNCH_TIMEOUT_MS: 5_000,
  /** Noise handshake timeout (ms) */
  NOISE_HANDSHAKE_TIMEOUT_MS: 10_000,
  /** Relay pairing timeout (ms) — server-side */
  RELAY_PAIR_TIMEOUT_MS: 30_000,
  /** Relay session max duration (ms) */
  RELAY_MAX_SESSION_MS: 3_600_000,
  /** Relay max message size (bytes) */
  RELAY_MAX_MESSAGE_BYTES: 65_536,
  /** Reconnect backoff base (ms) */
  RECONNECT_BASE_MS: 1_000,
  /** Reconnect backoff max (ms) */
  RECONNECT_MAX_MS: 30_000,
  /** Max reconnect attempts */
  RECONNECT_MAX_ATTEMPTS: 10,
  /** Invite default expiry (seconds) */
  INVITE_EXPIRY_S: 86_400,
  /** Channel keepalive ping interval (ms) */
  CHANNEL_KEEPALIVE_MS: 30_000,
} as const;
