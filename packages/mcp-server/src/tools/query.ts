import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { botName, forwardQueryToBot, parseAddress, isBotAddress, isValidName } from "@mecha/core";
import type { MeshMcpContext } from "../types.js";
import { textResult, errorResult, withAuditAndRateLimit, annotationsFor } from "./helpers.js";

/** Derive MCP source identity for X-Mecha-Source header. */
function mcpSource(ctx: MeshMcpContext): string {
  return `mcp:${ctx.clientInfo?.name ?? "unknown"}`;
}

/** Register query tools: mecha_query. */
export function registerQueryTools(server: McpServer, ctx: MeshMcpContext): void {
  server.registerTool(
    "mecha_query",
    {
      description: "Send a message to a bot and get a response",
      inputSchema: {
        target: z.string().describe("bot name (or name@node for remote)"),
        message: z.string().min(1).describe("Message to send"),
        sessionId: z.string().optional().describe("Session ID to continue (optional)"),
      },
      annotations: annotationsFor("mecha_query"),
    },
    withAuditAndRateLimit(ctx, "mecha_query", async (args) => {
      const target = args.target as string | undefined;
      const message = args.message as string | undefined;
      const sessionId = args.sessionId as string | undefined;

      if (!target) return errorResult("Missing required field: target");
      if (!message) return errorResult("Missing required field: message");

      // Parse address using canonical helper (handles validation, group addresses)
      let address;
      try {
        address = parseAddress(target);
      } catch {
        return errorResult(`Invalid target address: "${target}"`);
      }
      if (!isBotAddress(address)) {
        return errorResult("Group addresses are not supported for queries");
      }

      // Remote bot: name@node
      if (address.node !== "local") {
        const nodes = ctx.getNodes();
        const node = nodes.find((n) => n.name === address.node);
        if (!node) return errorResult(`Node not found: ${address.node}`);
        if (node.managed) return errorResult("Managed (P2P) nodes do not support query via HTTP yet");

        try {
          const body: Record<string, string> = { message };
          if (sessionId) body.sessionId = sessionId;
          const res = await ctx.agentFetch({
            node,
            path: `/bots/${encodeURIComponent(address.bot)}/query`,
            method: "POST",
            body,
            source: mcpSource(ctx),
            allowPrivateHosts: true,
          });
          if (!res.ok) return errorResult(`Remote node ${address.node} returned ${res.status}`);
          const data = (await res.json()) as Record<string, unknown>;
          return textResult(formatResponse(data));
        } catch (err: unknown) {
          return errorResult(
            `Failed to reach node ${address.node}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Local bot
      if (!isValidName(address.bot)) return errorResult(`Invalid bot name: "${address.bot}"`);
      const pt = ctx.pm.getPortAndToken(botName(address.bot));
      if (!pt) return errorResult(`Bot "${address.bot}" is not running`);

      try {
        const result = await forwardQueryToBot(pt.port, pt.token, message, sessionId);
        const parts = [result.text];
        if (result.sessionId) parts.push(`\n[sessionId: ${result.sessionId}]`);
        return textResult(parts.join(""));
      } catch (err: unknown) {
        return errorResult(
          `Query to "${address.bot}" failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );
}

/** Format a remote query response into readable text. */
function formatResponse(data: Record<string, unknown>): string {
  const text = typeof data.response === "string" ? data.response : JSON.stringify(data);
  const sid = typeof data.sessionId === "string" ? data.sessionId : undefined;
  const parts = [text];
  if (sid) parts.push(`\n[sessionId: ${sid}]`);
  return parts.join("");
}
