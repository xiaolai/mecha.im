import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { agentFetch } from "@mecha/service";
import { NodeUnreachableError } from "@mecha/contracts";
import type { ToolContext } from "./index.js";
import { toolError, textResult } from "../errors.js";

export function registerNodeTools(mcpServer: McpServer, ctx: ToolContext): void {
  mcpServer.tool(
    "mesh_list_nodes",
    "List all nodes in the mesh network with health status",
    {},
    async () => {
      try {
        const nodes = ctx.getNodes();
        const results = await Promise.all(
          nodes.map(async (node) => {
            const start = Date.now();
            try {
              await agentFetch(node, "/healthz", { timeoutMs: 3000 });
              return {
                name: node.name,
                host: node.host,
                status: "online" as const,
                latencyMs: Date.now() - start,
              };
            } catch (err) {
              if (err instanceof NodeUnreachableError) {
                return {
                  name: node.name,
                  host: node.host,
                  status: "offline" as const,
                  latencyMs: null,
                };
              }
              throw err;
            }
          }),
        );
        return textResult(JSON.stringify(results));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
