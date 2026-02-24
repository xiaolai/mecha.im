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

/** Default port assignments */
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
} as const;
