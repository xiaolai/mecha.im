import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { botName } from "@mecha/core";
import { botSessionList, botSessionGet } from "@mecha/service";
import type { MeshMcpContext } from "../types.js";
import { textResult, errorResult, withAuditAndRateLimit, annotationsFor } from "./helpers.js";

/** Register session tools: mecha_list_sessions, mecha_get_session. */
export function registerSessionTools(server: McpServer, ctx: MeshMcpContext): void {
  // mecha_list_sessions
  server.registerTool(
    "mecha_list_sessions",
    {
      description: "List sessions for a local bot",
      inputSchema: {
        target: z.string().describe("bot name"),
        limit: z.number().optional().describe("Max sessions to return"),
      },
      annotations: annotationsFor("mecha_list_sessions"),
    },
    withAuditAndRateLimit(ctx, "mecha_list_sessions", async (args) => {
      const target = args.target as string;
      const limit = args.limit as number | undefined;

      try {
        const sessions = await botSessionList(ctx.pm, botName(target));
        const limited = limit !== undefined && limit > 0 ? sessions.slice(0, limit) : sessions;
        if (limited.length === 0) {
          return textResult(`No sessions found for bot "${target}".`);
        }
        return textResult(JSON.stringify(limited, null, 2));
      } catch (err: unknown) {
        /* v8 ignore start -- non-Error throws are defensive */
        return errorResult(err instanceof Error ? err.message : String(err));
        /* v8 ignore stop */
      }
    }),
  );

  // mecha_get_session
  server.registerTool(
    "mecha_get_session",
    {
      description: "Get session detail for a local bot",
      inputSchema: {
        target: z.string().describe("bot name"),
        sessionId: z.string().describe("Session ID"),
      },
      annotations: annotationsFor("mecha_get_session"),
    },
    withAuditAndRateLimit(ctx, "mecha_get_session", async (args) => {
      const target = args.target as string;
      const sessionId = args.sessionId as string;

      try {
        const session = await botSessionGet(ctx.pm, botName(target), sessionId);
        if (!session) {
          return errorResult(`Session "${sessionId}" not found for bot "${target}".`);
        }
        return textResult(JSON.stringify(session, null, 2));
      } catch (err: unknown) {
        /* v8 ignore start -- non-Error throws are defensive */
        return errorResult(err instanceof Error ? err.message : String(err));
        /* v8 ignore stop */
      }
    }),
  );
}
