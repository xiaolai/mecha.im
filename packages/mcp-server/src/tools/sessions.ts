import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { casaName } from "@mecha/core";
import { casaSessionList, casaSessionGet } from "@mecha/service";
import type { MeshMcpContext } from "../types.js";
import { textResult, errorResult, withAuditAndRateLimit, annotationsFor } from "./helpers.js";

export function registerSessionTools(server: McpServer, ctx: MeshMcpContext): void {
  // mecha_list_sessions
  server.registerTool(
    "mecha_list_sessions",
    {
      description: "List sessions for a local CASA",
      inputSchema: {
        target: z.string().describe("CASA name"),
        limit: z.number().optional().describe("Max sessions to return"),
      },
      annotations: annotationsFor("mecha_list_sessions"),
    },
    withAuditAndRateLimit(ctx, "mecha_list_sessions", async (args) => {
      const target = args.target as string;
      const limit = args.limit as number | undefined;

      try {
        const sessions = await casaSessionList(ctx.pm, casaName(target));
        const limited = limit ? sessions.slice(0, limit) : sessions;
        if (limited.length === 0) {
          return textResult(`No sessions found for CASA "${target}".`);
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
      description: "Get session detail for a local CASA",
      inputSchema: {
        target: z.string().describe("CASA name"),
        sessionId: z.string().describe("Session ID"),
      },
      annotations: annotationsFor("mecha_get_session"),
    },
    withAuditAndRateLimit(ctx, "mecha_get_session", async (args) => {
      const target = args.target as string;
      const sessionId = args.sessionId as string;

      try {
        const session = await casaSessionGet(ctx.pm, casaName(target), sessionId);
        if (!session) {
          return errorResult(`Session "${sessionId}" not found for CASA "${target}".`);
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
