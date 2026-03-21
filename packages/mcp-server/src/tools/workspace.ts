import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { botName } from "@mecha/core";
import type { BotName } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { runtimeFetch } from "@mecha/service";
import type { MeshMcpContext } from "../types.js";
import { textResult, errorResult, withAuditAndRateLimit, annotationsFor } from "./helpers.js";

async function callRuntimeMcpTool(
  pm: ProcessManager,
  name: BotName,
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const result = await runtimeFetch(pm, name, "/mcp", {
    method: "POST",
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: toolArgs },
    },
  });
  const rpc = result.body as {
    result?: { content?: Array<{ type: string; text: string }>; isError?: boolean };
    error?: { message: string };
  };
  if (rpc.error) {
    return { content: [{ type: "text", text: rpc.error.message }], isError: true };
  }
  /* v8 ignore start -- defensive fallback for missing RPC result */
  const fallback = { content: [{ type: "text" as const, text: "No result" }], isError: true };
  return rpc.result?.content ? (rpc.result as { content: Array<{ type: string; text: string }>; isError?: boolean }) : fallback;
  /* v8 ignore stop */
}

/** Register workspace tools: mecha_workspace_list, mecha_workspace_read. */
export function registerWorkspaceTools(server: McpServer, ctx: MeshMcpContext): void {
  // mecha_workspace_list
  server.registerTool(
    "mecha_workspace_list",
    {
      description: "List files in a local bot's workspace",
      inputSchema: {
        target: z.string().describe("bot name"),
        path: z.string().optional().describe("Subdirectory path (default: root)"),
      },
      annotations: annotationsFor("mecha_workspace_list"),
    },
    withAuditAndRateLimit(ctx, "mecha_workspace_list", async (args) => {
      const target = args.target as string;
      const path = (args.path as string | undefined) ?? "";

      try {
        const result = await callRuntimeMcpTool(ctx.pm, botName(target), "mecha_workspace_list", { path });
        if (result.isError) {
          /* v8 ignore start -- content always has at least one entry */
          return errorResult(result.content[0]?.text ?? "Unknown error");
          /* v8 ignore stop */
        }
        /* v8 ignore start -- content always has at least one entry */
        return textResult(result.content[0]?.text ?? "");
        /* v8 ignore stop */
      } catch (err: unknown) {
        /* v8 ignore start -- non-Error throws are defensive */
        return errorResult(err instanceof Error ? err.message : String(err));
        /* v8 ignore stop */
      }
    }),
  );

  // mecha_workspace_read
  server.registerTool(
    "mecha_workspace_read",
    {
      description: "Read a file from a local bot's workspace",
      inputSchema: {
        target: z.string().describe("bot name"),
        path: z.string().describe("File path within workspace"),
      },
      annotations: annotationsFor("mecha_workspace_read"),
    },
    withAuditAndRateLimit(ctx, "mecha_workspace_read", async (args) => {
      const target = args.target as string;
      const path = args.path as string;

      try {
        const result = await callRuntimeMcpTool(ctx.pm, botName(target), "mecha_workspace_read", { path });
        if (result.isError) {
          /* v8 ignore start -- content always has at least one entry */
          return errorResult(result.content[0]?.text ?? "Unknown error");
          /* v8 ignore stop */
        }
        /* v8 ignore start -- content always has at least one entry */
        return textResult(result.content[0]?.text ?? "");
        /* v8 ignore stop */
      } catch (err: unknown) {
        /* v8 ignore start -- non-Error throws are defensive */
        return errorResult(err instanceof Error ? err.message : String(err));
        /* v8 ignore stop */
      }
    }),
  );
}
