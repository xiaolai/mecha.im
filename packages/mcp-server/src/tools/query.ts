import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { botName, forwardQueryToBot, parseAddress, isBotAddress } from "@mecha/core";
import type { MeshMcpContext } from "../types.js";
import { textResult, errorResult, withAuditAndRateLimit, annotationsFor } from "./helpers.js";

/** Derive MCP source identity for X-Mecha-Source header. */
function mcpSource(ctx: MeshMcpContext): string {
  return `mcp:${ctx.clientInfo?.name ?? "unknown"}`;
}

/** Format a query response (local or remote) into readable text. */
function formatResponse(data: Record<string, unknown>): string {
  const text = typeof data.response === "string" ? data.response : JSON.stringify(data);
  const sid = typeof data.sessionId === "string" ? data.sessionId : undefined;
  const parts = [text];
  if (sid) parts.push(`\n[sessionId: ${sid}]`);
  return parts.join("");
}

/** Query a remote bot via agentFetch. */
async function queryRemote(
  ctx: MeshMcpContext,
  botPart: string,
  nodeName: string,
  message: string,
  sessionId?: string,
): Promise<ReturnType<typeof textResult>> {
  const nodes = ctx.getNodes();
  const node = nodes.find((n) => n.name === nodeName);
  if (!node) return errorResult(`Node not found: ${nodeName}`);
  if (node.managed) return errorResult("Managed (P2P) nodes do not support query via HTTP yet");

  try {
    const body: Record<string, string> = { message };
    if (sessionId) body.sessionId = sessionId;
    const res = await ctx.agentFetch({
      node,
      path: `/bots/${encodeURIComponent(botPart)}/query`,
      method: "POST",
      body,
      source: mcpSource(ctx),
      // allowPrivateHosts: mesh nodes are on Tailscale/LAN overlay, not user-controlled URLs.
      // Node registry is admin-managed (via `mecha node add`), so hosts are trusted.
      // Same pattern as all other remote tools (discovery.ts).
      allowPrivateHosts: true,
    });
    if (!res.ok) return errorResult(`Remote node ${nodeName} returned ${res.status}`);
    const contentType = res.headers?.get?.("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = (await res.json()) as Record<string, unknown>;
      return textResult(formatResponse(data));
    }
    return textResult(await res.text());
  } catch (err: unknown) {
    return errorResult(
      `Failed to reach node ${nodeName}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Query a local bot via forwardQueryToBot. */
async function queryLocal(
  ctx: MeshMcpContext,
  bot: string,
  message: string,
  sessionId?: string,
): Promise<ReturnType<typeof textResult>> {
  const pt = ctx.pm.getPortAndToken(botName(bot));
  if (!pt) return errorResult(`Bot "${bot}" is not running`);

  try {
    const result = await forwardQueryToBot(pt.port, pt.token, message, sessionId);
    return textResult(formatResponse({
      response: result.text,
      sessionId: result.sessionId,
    }));
  } catch (err: unknown) {
    return errorResult(
      `Query to "${bot}" failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Register query tools: mecha_query.
 *
 * Sends a message to a bot and returns the response as plain text.
 * Output format: response text, optionally followed by `\n[sessionId: <id>]`.
 * Accepts `bot-name` (local) or `bot-name@node-name` (remote). Group addresses are rejected.
 */
export function registerQueryTools(server: McpServer, ctx: MeshMcpContext): void {
  server.registerTool(
    "mecha_query",
    {
      description: "Send a message to a bot and get a response. Returns text, optionally with [sessionId: ...] for continuity.",
      inputSchema: {
        target: z.string().describe("bot name (local) or name@node (remote). Group addresses not supported."),
        message: z.string().min(1).describe("Message to send"),
        sessionId: z.string().optional().describe("Session ID to continue (optional)"),
      },
      annotations: annotationsFor("mecha_query"),
    },
    withAuditAndRateLimit(ctx, "mecha_query", async (args) => {
      const target = typeof args.target === "string" ? args.target : undefined;
      const message = typeof args.message === "string" ? args.message : undefined;
      const sessionId = typeof args.sessionId === "string" ? args.sessionId : undefined;

      if (!target) return errorResult("Missing required field: target");
      if (!message) return errorResult("Missing required field: message");

      let address;
      try {
        address = parseAddress(target);
      } catch {
        return errorResult(`Invalid target address: "${target}"`);
      }
      if (!isBotAddress(address)) {
        return errorResult("Group addresses are not supported for queries");
      }

      if (address.node !== "local") {
        return queryRemote(ctx, address.bot, address.node, message, sessionId);
      }
      return queryLocal(ctx, address.bot, message, sessionId);
    }),
  );
}
