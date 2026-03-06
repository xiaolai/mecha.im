import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MeshMcpContext } from "./types.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerWorkspaceTools } from "./tools/workspace.js";
import { registerQueryTools } from "./tools/query.js";

/** Create and configure the Mecha MCP server with all tool groups registered. */
export function createMeshMcpServer(ctx: MeshMcpContext): McpServer {
  const server = new McpServer({
    name: "mecha",
    version: "0.2.0",
  });

  registerDiscoveryTools(server, ctx);
  registerSessionTools(server, ctx);
  registerWorkspaceTools(server, ctx);

  if (ctx.mode === "query") {
    registerQueryTools(server, ctx);
  }

  return server;
}
