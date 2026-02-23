import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProcessManager } from "@mecha/process";
import { MechaLocator } from "@mecha/service";
import type { NodeEntry } from "@mecha/agent";
import { registerAllTools } from "./tools/index.js";

export interface MeshMcpOptions {
  pm: ProcessManager;
  /** Provider of current node list. Called on each tool invocation. */
  getNodes: () => NodeEntry[];
  /** Shared locator instance (optional, created if omitted). */
  locator?: MechaLocator;
}

export interface MeshMcpHandle {
  mcpServer: McpServer;
  locator: MechaLocator;
}

export function createMeshMcpServer(opts: MeshMcpOptions): MeshMcpHandle {
  const locator = opts.locator ?? new MechaLocator();
  const mcpServer = new McpServer(
    { name: "mecha-mesh", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  registerAllTools(mcpServer, {
    pm: opts.pm,
    getNodes: opts.getNodes,
    locator,
  });

  return { mcpServer, locator };
}
