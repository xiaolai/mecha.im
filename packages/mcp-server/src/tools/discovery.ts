import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "node:path";
import { readBotConfig, DEFAULTS, botName } from "@mecha/core";
import { botFind, botStatus } from "@mecha/service";
import type { MeshMcpContext } from "../types.js";
import { textResult, errorResult, withAuditAndRateLimit, annotationsFor } from "./helpers.js";

/** Derive MCP source identity for X-Mecha-Source header. */
function mcpSource(ctx: MeshMcpContext): string {
  return `mcp:${ctx.clientInfo?.name ?? "unknown"}`;
}

/** Register discovery tools: mecha_list_nodes, mecha_list_bots, mecha_bot_status, mecha_discover. */
export function registerDiscoveryTools(server: McpServer, ctx: MeshMcpContext): void {
  // mecha_list_nodes
  server.registerTool(
    "mecha_list_nodes",
    {
      description: "List all mesh nodes with health status",
      annotations: annotationsFor("mecha_list_nodes"),
    },
    withAuditAndRateLimit(ctx, "mecha_list_nodes", async () => {
      const nodes = ctx.getNodes();
      if (nodes.length === 0) {
        return textResult("No mesh nodes registered. Use `mecha node add` to add remote nodes.");
      }

      const results = await Promise.allSettled(
        nodes.map(async (node) => {
          if (node.managed) {
            return { name: node.name, host: "p2p", port: 0, healthy: false, latencyMs: -1, managed: true };
          }
          const start = Date.now();
          const res = await ctx.agentFetch({
            node,
            path: "/healthz",
            timeoutMs: DEFAULTS.AGENT_STATUS_TIMEOUT_MS,
            source: mcpSource(ctx),
            allowPrivateHosts: true,
          });
          return {
            name: node.name, host: node.host, port: node.port,
            healthy: res.ok, latencyMs: Date.now() - start, managed: false,
          };
        }),
      );

      const rows = results.map((r, i) => {
        if (r.status === "fulfilled") return r.value;
        const n = nodes[i]!;
        return { name: n.name, host: n.host, port: n.port, healthy: false, latencyMs: -1, managed: !!n.managed };
      });

      const lines = rows.map((r) => {
        const status = r.managed ? "p2p (no http)" : r.healthy ? "healthy" : "unreachable";
        const latency = r.latencyMs >= 0 ? `${r.latencyMs}ms` : "n/a";
        return `${r.name}: ${status} (${r.host}:${r.port}, ${latency})`;
      });
      return textResult(lines.join("\n"));
    }),
  );

  // mecha_list_bots
  server.registerTool(
    "mecha_list_bots",
    {
      description: "List bots (local, or from a specific remote node)",
      inputSchema: {
        node: z.string().optional().describe("Remote node name to query (omit for local)"),
        limit: z.number().optional().describe("Max results to return"),
      },
      annotations: annotationsFor("mecha_list_bots"),
    },
    withAuditAndRateLimit(ctx, "mecha_list_bots", async (args) => {
      const nodeFilter = args.node as string | undefined;
      const limit = args.limit as number | undefined;

      if (nodeFilter) {
        const nodes = ctx.getNodes();
        const node = nodes.find((n) => n.name === nodeFilter);
        if (!node) return errorResult(`Node not found: ${nodeFilter}`);
        if (node.managed) return errorResult("Managed (P2P) nodes do not support remote listing via HTTP");
        try {
          const res = await ctx.agentFetch({ node, path: "/bots", source: mcpSource(ctx), allowPrivateHosts: true });
          if (!res.ok) return errorResult(`Remote node returned ${res.status}`);
          const remote = await res.json() as Array<{ name: string; state: string; port?: number }>;
          const limited = limit !== undefined && limit > 0 ? remote.slice(0, limit) : remote;
          const lines = limited.map((c) => `${c.name}: ${c.state}${c.port ? ` (port ${c.port})` : ""}`);
          return textResult(`bots on ${nodeFilter}:\n${lines.join("\n")}`);
        } catch (err: unknown) {
          /* v8 ignore start -- non-Error throws are defensive */
          return errorResult(`Failed to reach node ${nodeFilter}: ${err instanceof Error ? err.message : String(err)}`);
          /* v8 ignore stop */
        }
      }

      const bots = botFind(ctx.mechaDir, ctx.pm, {});
      const limited = limit !== undefined && limit > 0 ? bots.slice(0, limit) : bots;
      if (limited.length === 0) {
        return textResult("No bots found. Use `mecha spawn <name>` to create one.");
      }
      const lines = limited.map((c) => {
        const tags = c.tags.length > 0 ? ` [${c.tags.join(", ")}]` : "";
        return `${c.name}: ${c.state}${c.port ? ` (port ${c.port})` : ""}${tags}`;
      });
      return textResult(lines.join("\n"));
    }),
  );

  // mecha_bot_status
  server.registerTool(
    "mecha_bot_status",
    {
      description: "Get detailed status for a specific bot",
      inputSchema: {
        target: z.string().describe("bot name (or name@node for remote)"),
      },
      annotations: annotationsFor("mecha_bot_status"),
    },
    withAuditAndRateLimit(ctx, "mecha_bot_status", async (args) => {
      const target = args.target as string;
      const atIdx = target.indexOf("@");

      if (atIdx !== -1) {
        const botName = target.slice(0, atIdx);
        const nodeName = target.slice(atIdx + 1);
        const nodes = ctx.getNodes();
        const node = nodes.find((n) => n.name === nodeName);
        if (!node) return errorResult(`Node not found: ${nodeName}`);
        if (node.managed) return errorResult("Managed (P2P) nodes do not support remote status via HTTP");
        try {
          const res = await ctx.agentFetch({
            node,
            path: `/bots/${encodeURIComponent(botName)}/status`,
            source: mcpSource(ctx),
            allowPrivateHosts: true,
          });
          if (!res.ok) return errorResult(`Remote node returned ${res.status}`);
          const data = await res.json();
          return textResult(JSON.stringify(data, null, 2));
        } catch (err: unknown) {
          /* v8 ignore start -- non-Error throws are defensive */
          return errorResult(`Failed to reach node ${nodeName}: ${err instanceof Error ? err.message : String(err)}`);
          /* v8 ignore stop */
        }
      }

      try {
        const info = botStatus(ctx.pm, botName(target));
        /* v8 ignore start -- null coalescing fallback for optional fields */
        const lines = [
          `Name: ${info.name}`,
          `State: ${info.state}`,
          `PID: ${info.pid ?? "n/a"}`,
          `Port: ${info.port ?? "n/a"}`,
          `Workspace: ${info.workspacePath ?? "n/a"}`,
        ];
        /* v8 ignore stop */
        return textResult(lines.join("\n"));
      } catch (err: unknown) {
        /* v8 ignore start -- non-Error throws are defensive */
        return errorResult(err instanceof Error ? err.message : String(err));
        /* v8 ignore stop */
      }
    }),
  );

  // mecha_discover
  server.registerTool(
    "mecha_discover",
    {
      description: "Find bots by tag or capability (local only)",
      inputSchema: {
        tag: z.string().optional().describe("Filter by tag"),
        capability: z.string().optional().describe("Filter by exposed capability"),
        limit: z.number().optional().describe("Max results to return"),
      },
      annotations: annotationsFor("mecha_discover"),
    },
    withAuditAndRateLimit(ctx, "mecha_discover", async (args) => {
      const tag = args.tag as string | undefined;
      const capability = args.capability as string | undefined;
      const limit = args.limit as number | undefined;

      let bots = botFind(ctx.mechaDir, ctx.pm, { tags: tag ? [tag] : undefined });

      if (capability) {
        bots = bots.filter((c) => {
          const config = readBotConfig(join(ctx.mechaDir, c.name));
          /* v8 ignore start -- null coalescing for missing config/expose */
          const exposed = (config?.expose as string[] | undefined) ?? [];
          /* v8 ignore stop */
          return exposed.includes(capability);
        });
      }

      const limited = limit !== undefined && limit > 0 ? bots.slice(0, limit) : bots;
      if (limited.length === 0) {
        return textResult("No bots match the given filters.");
      }
      const lines = limited.map((c) => {
        const tags = c.tags.length > 0 ? ` [${c.tags.join(", ")}]` : "";
        return `${c.name}: ${c.state}${tags}`;
      });
      return textResult(lines.join("\n"));
    }),
  );
}
