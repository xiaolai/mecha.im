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
  /** MCP HTTP transport port (Phase 7) */
  MCP_HTTP_PORT: 7670,
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
  /** Default metering proxy port */
  METER_PORT: 7600,
  /** Metering proxy shutdown grace period (ms) */
  METER_STOP_GRACE_MS: 30_000,
  /** Hot counter snapshot interval (ms) */
  METER_SNAPSHOT_INTERVAL_MS: 10_000,
  /** Rollup flush interval (ms) */
  METER_ROLLUP_INTERVAL_MS: 60_000,
  /** CASA registry rescan interval (ms) */
  METER_REGISTRY_INTERVAL_MS: 30_000,
  /** Event buffer flush: max events before forced flush */
  METER_EVENT_BUFFER_MAX: 100,
  /** Event buffer flush: max seconds before forced flush */
  METER_EVENT_BUFFER_INTERVAL_MS: 5_000,
  /** Default event retention (days) */
  METER_RETENTION_DAYS: 90,
} as const;
