import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteSessionDelete, remoteSessionMetaUpdate } from "@mecha/service";
import type { ToolContext } from "./index.js";
import { toolError, textResult } from "../errors.js";

export function registerManageTools(mcpServer: McpServer, ctx: ToolContext): void {
  mcpServer.tool(
    "mesh_delete_session",
    "Delete a session from a mecha",
    {
      mecha_id: z.string().describe("The mecha ID"),
      session_id: z.string().describe("The session ID to delete"),
    },
    async ({ mecha_id, session_id }) => {
      try {
        const ref = await ctx.locator.locate(ctx.docker, mecha_id, ctx.getNodes());
        await remoteSessionDelete(ctx.docker, mecha_id, session_id, {
          node: ref.node,
          entry: ref.entry,
        });
        return textResult(JSON.stringify({ deleted: true }));
      } catch (err) {
        return toolError(err, ctx.locator, mecha_id);
      }
    },
  );

  mcpServer.tool(
    "mesh_star_session",
    "Star or unstar a session",
    {
      mecha_id: z.string().describe("The mecha ID"),
      session_id: z.string().describe("The session ID"),
      starred: z.boolean().describe("Whether to star (true) or unstar (false)"),
    },
    async ({ mecha_id, session_id, starred }) => {
      try {
        const ref = await ctx.locator.locate(ctx.docker, mecha_id, ctx.getNodes());
        await remoteSessionMetaUpdate(mecha_id, session_id, { starred }, {
          node: ref.node,
          entry: ref.entry,
        });
        return textResult(JSON.stringify({ ok: true }));
      } catch (err) {
        return toolError(err, ctx.locator, mecha_id);
      }
    },
  );

  mcpServer.tool(
    "mesh_rename_session",
    "Rename a session",
    {
      mecha_id: z.string().describe("The mecha ID"),
      session_id: z.string().describe("The session ID"),
      title: z.string().min(1).describe("The new title"),
    },
    async ({ mecha_id, session_id, title }) => {
      try {
        const ref = await ctx.locator.locate(ctx.docker, mecha_id, ctx.getNodes());
        await remoteSessionMetaUpdate(mecha_id, session_id, { customTitle: title }, {
          node: ref.node,
          entry: ref.entry,
        });
        return textResult(JSON.stringify({ ok: true }));
      } catch (err) {
        return toolError(err, ctx.locator, mecha_id);
      }
    },
  );
}
