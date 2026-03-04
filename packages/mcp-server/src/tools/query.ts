import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MeshMcpContext } from "../types.js";
import { textResult, withAuditAndRateLimit, annotationsFor } from "./helpers.js";

export function registerQueryTools(server: McpServer, ctx: MeshMcpContext): void {
  server.registerTool(
    "mecha_query",
    {
      description: "Send a message to a bot and get a response (not yet available — wave 2)",
      inputSchema: {
        target: z.string().describe("bot name (or name@node for remote)"),
        message: z.string().describe("Message to send"),
        sessionId: z.string().optional().describe("Session ID to continue (optional)"),
      },
      annotations: annotationsFor("mecha_query"),
    },
    withAuditAndRateLimit(ctx, "mecha_query", async () => {
      return textResult(
        "mecha_query is not yet available. " +
        "This tool will be enabled in wave 2 when the chat routing path is implemented. " +
        "For now, use `mecha bot chat <bot>` from the CLI to interact with bots.",
      );
    }),
  );
}
