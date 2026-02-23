import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mechaLs, mechaStatus, agentFetch } from "@mecha/service";
import { NodeUnreachableError } from "@mecha/contracts";
import type { ToolContext } from "./index.js";
import { toolError, textResult } from "../errors.js";

export function registerMechaTools(mcpServer: McpServer, ctx: ToolContext): void {
  mcpServer.tool(
    "mesh_list_mechas",
    "List all mechas across all mesh nodes",
    { node: z.string().optional().describe("Filter by node name") },
    async ({ node: nodeFilter }) => {
      try {
        const results: Array<{
          node: string;
          id: string;
          name: string;
          state: string;
          path: string;
          port?: number;
        }> = [];

        // Local mechas
        if (!nodeFilter || nodeFilter === "local") {
          const locals = await mechaLs(ctx.docker);
          for (const m of locals) {
            results.push({
              node: "local",
              id: m.id,
              name: m.name,
              state: m.state,
              path: m.path,
              port: m.port,
            });
          }
        }

        // Remote mechas
        const nodes = ctx.getNodes();
        for (const entry of nodes) {
          if (nodeFilter && nodeFilter !== entry.name) continue;
          try {
            const res = await agentFetch(entry, "/mechas");
            const mechas = (await res.json()) as Array<{
              id: string;
              name: string;
              state: string;
              path: string;
              port?: number;
            }>;
            for (const m of mechas) {
              results.push({ node: entry.name, ...m });
            }
          } catch (err) {
            if (err instanceof NodeUnreachableError) continue;
            throw err;
          }
        }

        return textResult(JSON.stringify(results));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  mcpServer.tool(
    "mesh_mecha_status",
    "Get detailed status for a specific mecha",
    { mecha_id: z.string().describe("The mecha ID to inspect") },
    async ({ mecha_id }) => {
      try {
        const ref = await ctx.locator.locate(ctx.docker, mecha_id, ctx.getNodes());
        if (ref.node === "local") {
          const status = await mechaStatus(ctx.docker, mecha_id);
          return textResult(JSON.stringify({ node: "local", ...status }));
        }
        const mid = encodeURIComponent(mecha_id);
        const res = await agentFetch(ref.entry!, `/mechas/${mid}`);
        const data = await res.json();
        return textResult(JSON.stringify({ node: ref.node, ...data as object }));
      } catch (err) {
        return toolError(err, ctx.locator, mecha_id);
      }
    },
  );
}
