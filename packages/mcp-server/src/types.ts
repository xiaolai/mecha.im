import type { ProcessManager } from "@mecha/process";
import type { NodeEntry } from "@mecha/core";
import type { agentFetch } from "@mecha/service";
import type { AuditLog } from "./audit.js";
import type { RateLimiter } from "./rate-limit.js";

/** Shared context passed to all MCP tool handlers. */
export interface MeshMcpContext {
  mechaDir: string;
  pm: ProcessManager;
  getNodes: () => NodeEntry[];
  agentFetch: typeof agentFetch;
  mode: "read-only" | "query";
  audit: AuditLog;
  rateLimiter: RateLimiter;
  clientInfo?: { name: string; version: string };
}

/** MCP tool annotations (readOnlyHint / destructiveHint) keyed by tool name. */
export const TOOL_ANNOTATIONS = {
  mecha_list_nodes:     { readOnlyHint: true,  destructiveHint: false },
  mecha_list_bots:     { readOnlyHint: true,  destructiveHint: false },
  mecha_bot_status:    { readOnlyHint: true,  destructiveHint: false },
  mecha_discover:       { readOnlyHint: true,  destructiveHint: false },
  mecha_list_sessions:  { readOnlyHint: true,  destructiveHint: false },
  mecha_get_session:    { readOnlyHint: true,  destructiveHint: false },
  mecha_query:          { readOnlyHint: false, destructiveHint: false },
  mecha_workspace_list: { readOnlyHint: true,  destructiveHint: false },
  mecha_workspace_read: { readOnlyHint: true,  destructiveHint: false },
} as const;

/** Union of all registered MCP tool names. */
export type ToolName = keyof typeof TOOL_ANNOTATIONS;
