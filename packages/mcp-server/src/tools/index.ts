import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProcessManager } from "@mecha/process";
import type { MechaLocator } from "@mecha/service";
import type { NodeEntry } from "@mecha/agent";
import { registerNodeTools } from "./nodes.js";
import { registerMechaTools } from "./mechas.js";
import { registerSessionTools } from "./sessions.js";
import { registerQueryTools } from "./query.js";
import { registerManageTools } from "./manage.js";
import { registerWorkspaceTools } from "./workspace.js";

export interface ToolContext {
  pm: ProcessManager;
  getNodes: () => NodeEntry[];
  locator: MechaLocator;
}

export function registerAllTools(mcpServer: McpServer, ctx: ToolContext): void {
  registerNodeTools(mcpServer, ctx);
  registerMechaTools(mcpServer, ctx);
  registerSessionTools(mcpServer, ctx);
  registerQueryTools(mcpServer, ctx);
  registerManageTools(mcpServer, ctx);
  registerWorkspaceTools(mcpServer, ctx);
}
