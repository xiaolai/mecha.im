import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteSessionList, remoteSessionGet } from "@mecha/service";
import type { ToolContext } from "./index.js";
import { toolError, textResult } from "../errors.js";

export function registerSessionTools(mcpServer: McpServer, ctx: ToolContext): void {
  mcpServer.tool(
    "mesh_list_sessions",
    "List all sessions for a mecha",
    { mecha_id: z.string().describe("The mecha ID") },
    async ({ mecha_id }) => {
      try {
        const ref = await ctx.locator.locate(ctx.pm, mecha_id, ctx.getNodes());
        const result = await remoteSessionList(ctx.pm, mecha_id, {
          node: ref.node,
          entry: ref.entry,
        });
        return textResult(JSON.stringify(result));
      } catch (err) {
        return toolError(err, ctx.locator, mecha_id);
      }
    },
  );

  mcpServer.tool(
    "mesh_get_session",
    "Get a specific session with optional message history",
    {
      mecha_id: z.string().describe("The mecha ID"),
      session_id: z.string().describe("The session ID"),
      include_messages: z.boolean().optional().describe("Include full message history (default: false)"),
    },
    async ({ mecha_id, session_id, include_messages }) => {
      try {
        const ref = await ctx.locator.locate(ctx.pm, mecha_id, ctx.getNodes());
        const session = await remoteSessionGet(ctx.pm, mecha_id, session_id, {
          node: ref.node,
          entry: ref.entry,
        });
        if (!include_messages) {
          const { messages: _, ...rest } = session as unknown as Record<string, unknown>;
          return textResult(JSON.stringify(rest));
        }
        return textResult(JSON.stringify(session));
      } catch (err) {
        return toolError(err, ctx.locator, mecha_id);
      }
    },
  );
}
