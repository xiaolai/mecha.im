import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveMcpEndpoint, agentFetch } from "@mecha/service";
import type { ToolContext } from "./index.js";
import { toolError, textResult } from "../errors.js";

/**
 * Call a tool on a per-container MCP endpoint via HTTP.
 * Sends a JSON-RPC request to the container's /mcp endpoint.
 */
async function callContainerMcpTool(
  endpoint: string,
  token: string | undefined,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`Container MCP request failed: ${res.status}`);
  }

  const result = (await res.json()) as {
    result?: { content?: Array<{ type: string; text: string }> };
    error?: { message: string };
  };

  if (result.error) throw new Error(result.error.message);
  const content = result.result?.content;
  if (content?.[0]?.type === "text") {
    try { return JSON.parse(content[0].text); }
    catch { return content[0].text; }
  }
  return content;
}

export function registerWorkspaceTools(mcpServer: McpServer, ctx: ToolContext): void {
  mcpServer.tool(
    "mesh_workspace_list",
    "List files in a mecha's workspace",
    {
      mecha_id: z.string().describe("The mecha ID"),
      path: z.string().optional().describe("Subdirectory path within the workspace"),
    },
    async ({ mecha_id, path }) => {
      try {
        const ref = await ctx.locator.locate(ctx.docker, mecha_id, ctx.getNodes());

        if (ref.node === "local") {
          const { endpoint, token } = await resolveMcpEndpoint(ctx.docker, mecha_id);
          const result = await callContainerMcpTool(endpoint, token, "mecha_workspace_list", {
            ...(path !== undefined && { path }),
          });
          return textResult(JSON.stringify(result));
        }

        // Remote: proxy via agent to container MCP
        const mid = encodeURIComponent(mecha_id);
        const res = await agentFetch(ref.entry!, `/mechas/${mid}/mcp-endpoint`);
        const { endpoint, token } = (await res.json()) as { endpoint: string; token?: string };
        const result = await callContainerMcpTool(endpoint, token, "mecha_workspace_list", {
          ...(path !== undefined && { path }),
        });
        return textResult(JSON.stringify(result));
      } catch (err) {
        return toolError(err, ctx.locator, mecha_id);
      }
    },
  );

  mcpServer.tool(
    "mesh_workspace_read",
    "Read a file from a mecha's workspace",
    {
      mecha_id: z.string().describe("The mecha ID"),
      path: z.string().describe("File path relative to the workspace"),
    },
    async ({ mecha_id, path }) => {
      try {
        const ref = await ctx.locator.locate(ctx.docker, mecha_id, ctx.getNodes());

        if (ref.node === "local") {
          const { endpoint, token } = await resolveMcpEndpoint(ctx.docker, mecha_id);
          const result = await callContainerMcpTool(endpoint, token, "mecha_workspace_read", { path });
          return textResult(typeof result === "string" ? result : JSON.stringify(result));
        }

        const mid = encodeURIComponent(mecha_id);
        const res = await agentFetch(ref.entry!, `/mechas/${mid}/mcp-endpoint`);
        const { endpoint, token } = (await res.json()) as { endpoint: string; token?: string };
        const result = await callContainerMcpTool(endpoint, token, "mecha_workspace_read", { path });
        return textResult(typeof result === "string" ? result : JSON.stringify(result));
      } catch (err) {
        return toolError(err, ctx.locator, mecha_id);
      }
    },
  );
}
