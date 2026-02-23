/** Default configuration values */
export const DEFAULTS = {
  /** Default host port base (auto-assigned from this range) */
  PORT_BASE: 7700,
  /** Port range upper bound */
  PORT_MAX: 7799,
  /** Heartbeat interval in milliseconds */
  HEARTBEAT_INTERVAL_MS: 30_000,
  /** Process stop timeout in milliseconds */
  STOP_TIMEOUT_MS: 10_000,
  /** Home directory for mecha global config */
  HOME_DIR: ".mecha",
  /** Default dashboard port */
  DASHBOARD_PORT: 7600,
  /** Subdirectory for per-process state files */
  STATE_DIR: "processes",
  /** Subdirectory for process log files */
  LOG_DIR: "logs",
  /** Filename for the append-only event log */
  EVENTS_FILE: "events.jsonl",
} as const;

// --- Deprecated Docker constants (will be removed in Phase 7) ---

/** @deprecated Docker-only. Will be removed. */
export const MOUNT_PATHS = {
  WORKSPACE: "/home/mecha",
  STATE: "/var/lib/mecha",
  TMP: "/tmp",
} as const;

/** @deprecated Docker-only. Will be removed. */
export const LABELS = {
  IS_MECHA: "mecha",
  MECHA_ID: "mecha.id",
  MECHA_PATH: "mecha.path",
} as const;

/** @deprecated Docker-only. Will be removed. */
export const SECURITY = {
  UID: 1000,
  GID: 1000,
  CAP_DROP: ["ALL"],
  SECURITY_OPT: ["no-new-privileges"],
} as const;
