import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { agentFetch, mechaSessionCreate } from "@mecha/service";
import { runtimeFetch } from "@mecha/service";
import type { ToolContext } from "./index.js";
import { toolError, textResult } from "../errors.js";

/** Parse SSE event stream and extract text content from assistant messages. */
export async function collectSseResponse(res: Response): Promise<string> {
  const parts: string[] = [];
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6);
      if (json === "[DONE]") continue;
      try {
        const event = JSON.parse(json) as {
          type?: string;
          message?: { content?: Array<{ type?: string; text?: string }> };
        };
        if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "text" && block.text) parts.push(block.text);
          }
        }
      } catch {
        /* skip malformed lines */
      }
    }
  }
  return parts.join("");
}

export function registerQueryTools(mcpServer: McpServer, ctx: ToolContext): void {
  mcpServer.tool(
    "mesh_create_session",
    "Create a new session on a mecha",
    {
      mecha_id: z.string().describe("The mecha ID"),
      title: z.string().optional().describe("Optional session title"),
    },
    async ({ mecha_id, title }) => {
      try {
        const ref = await ctx.locator.locate(ctx.docker, mecha_id, ctx.getNodes());
        if (ref.node === "local") {
          const result = (await mechaSessionCreate(ctx.docker, { id: mecha_id, title })) as {
            id?: string;
            sessionId?: string;
          };
          return textResult(
            JSON.stringify({
              session_id: result.id ?? result.sessionId,
              mecha_id,
              node: "local",
            }),
          );
        }
        const mid = encodeURIComponent(mecha_id);
        const res = await agentFetch(ref.entry!, `/mechas/${mid}/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
        const data = (await res.json()) as { id?: string; sessionId?: string };
        return textResult(
          JSON.stringify({
            session_id: data.id ?? data.sessionId,
            mecha_id,
            node: ref.node,
          }),
        );
      } catch (err) {
        return toolError(err, ctx.locator, mecha_id);
      }
    },
  );

  mcpServer.tool(
    "mesh_query",
    "Send a message to a mecha and get the response",
    {
      mecha_id: z.string().describe("The mecha ID"),
      message: z.string().describe("The message to send"),
      session_id: z.string().optional().describe("Resume an existing session (omit to auto-create)"),
    },
    async ({ mecha_id, message, session_id }) => {
      try {
        const ref = await ctx.locator.locate(ctx.docker, mecha_id, ctx.getNodes());

        // Create session if needed
        let sid = session_id;
        if (!sid) {
          if (ref.node === "local") {
            const created = (await mechaSessionCreate(ctx.docker, { id: mecha_id })) as {
              id?: string;
              sessionId?: string;
            };
            sid = created.id ?? created.sessionId;
          } else {
            const mid = encodeURIComponent(mecha_id);
            const res = await agentFetch(ref.entry!, `/mechas/${mid}/sessions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            });
            const data = (await res.json()) as { id?: string; sessionId?: string };
            sid = data.id ?? data.sessionId;
          }
        }

        // Send message
        const encodedSid = encodeURIComponent(sid!);
        let response: string;

        if (ref.node === "local") {
          const res = await runtimeFetch(
            ctx.docker,
            mecha_id,
            `/api/sessions/${encodedSid}/message`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message }),
              signal: undefined, // no timeout for streaming
            },
          );
          response = await collectSseResponse(res);
        } else {
          const mid = encodeURIComponent(mecha_id);
          const res = await agentFetch(
            ref.entry!,
            `/mechas/${mid}/sessions/${encodedSid}/message`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message }),
              timeoutMs: 0, // no timeout for LLM responses
            },
          );
          response = await collectSseResponse(res);
        }

        return textResult(JSON.stringify({ session_id: sid, response: response || "(no response)" }));
      } catch (err) {
        return toolError(err, ctx.locator, mecha_id);
      }
    },
  );
}
