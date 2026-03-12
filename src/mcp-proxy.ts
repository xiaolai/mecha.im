/**
 * MCP stdio server — exposes all mecha bots as tools via a single MCP server.
 *
 * Usage in .mcp.json:
 *   { "mecha": { "command": "mecha", "args": ["mcp"] } }
 *
 * Tools exposed:
 *   - query: Send a prompt to any bot by name
 *   - status: Check a bot's status
 *   - list: List all available bots
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getBot } from "./store.js";
import { resolveHostBotBaseUrl } from "./resolve-endpoint.js";
import { isValidName } from "../shared/validation.js";
import * as docker from "./docker.js";

// Bot name schema — reuses the same validation as CLI
const botNameSchema = z.string().min(1).max(32)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "Invalid bot name (lowercase alphanumeric + hyphens)")
  .describe("Bot name (e.g. posca, reviewer)");

/** Read an SSE stream from a bot /prompt response and collect the text */
async function collectSSEResponse(resp: Response): Promise<{
  text: string;
  sessionId?: string;
  costUsd?: number;
  durationMs?: number;
  success: boolean;
  error?: string;
}> {
  const reader = resp.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let sessionId: string | undefined;
  let costUsd: number | undefined;
  let durationMs: number | undefined;
  let success = true;
  let error: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const parsed = JSON.parse(line.slice(6));
        if (parsed.content) text += parsed.content;
        if (parsed.message && !parsed.task_id) {
          error = parsed.message;
          success = false;
        }
        if (parsed.cost_usd !== undefined) {
          costUsd = parsed.cost_usd;
          durationMs = parsed.duration_ms;
          sessionId = parsed.session_id;
          if (parsed.success === false) success = false;
        }
      } catch { /* non-JSON SSE data */ }
    }
  }

  return { text, sessionId, costUsd, durationMs, success, error };
}

function authHeaders(botToken?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (botToken) h["Authorization"] = `Bearer ${botToken}`;
  return h;
}

function mcpError(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "mecha",
    version: "0.1.0",
  });

  // --- query tool ---
  server.tool(
    "query",
    "Send a prompt to a mecha bot and get its response",
    {
      bot: botNameSchema,
      message: z.string().min(1).describe("The prompt message to send"),
      model: z.string().optional().describe("Override model (sonnet, opus, haiku)"),
      system: z.string().optional().describe("Override system prompt"),
      max_turns: z.number().int().min(1).optional().describe("Override max turns"),
      resume: z.string().min(1).optional().describe("Resume a specific session ID"),
      effort: z.enum(["low", "medium", "high", "max"]).optional().describe("Thinking effort level"),
      max_budget_usd: z.number().positive().optional().describe("Max budget in USD"),
    },
    async (args) => {
      if (!isValidName(args.bot)) return mcpError(`Invalid bot name: "${args.bot}"`);

      const { bot, ...body } = args;
      const entry = getBot(bot);
      const resolved = await resolveHostBotBaseUrl(bot);
      if (!resolved) return mcpError(`Bot "${bot}" not found or not reachable`);

      try {
        const resp = await fetch(`${resolved.baseUrl}/prompt`, {
          method: "POST",
          headers: authHeaders(entry?.botToken),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5 * 60 * 1000),
        });

        if (resp.status === 409) return mcpError(`Bot "${bot}" is busy processing another request`);
        if (!resp.ok) return mcpError(`Error from bot: ${resp.status} ${resp.statusText}`);

        const result = await collectSSEResponse(resp);

        if (!result.success) {
          const errText = result.error ?? "Bot run failed";
          return mcpError(`${errText}${result.text ? `\n\nPartial output:\n${result.text}` : ""}`);
        }

        const meta = [
          result.sessionId && `session: ${result.sessionId}`,
          result.costUsd !== undefined && `cost: $${result.costUsd.toFixed(4)}`,
          result.durationMs && `duration: ${result.durationMs}ms`,
        ].filter(Boolean).join(" | ");

        return {
          content: [
            { type: "text" as const, text: result.text },
            ...(meta ? [{ type: "text" as const, text: `\n---\n${meta}` }] : []),
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return mcpError(`Network error reaching bot "${bot}": ${msg}`);
      }
    },
  );

  // --- status tool ---
  server.tool(
    "status",
    "Check the status of a mecha bot (idle, busy, model, uptime)",
    {
      bot: botNameSchema,
    },
    async (args) => {
      if (!isValidName(args.bot)) return mcpError(`Invalid bot name: "${args.bot}"`);

      const entry = getBot(args.bot);
      const resolved = await resolveHostBotBaseUrl(args.bot);
      if (!resolved) return mcpError(`Bot "${args.bot}" not found or not reachable`);

      try {
        const resp = await fetch(`${resolved.baseUrl}/api/status`, {
          headers: authHeaders(entry?.botToken),
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) return mcpError(`Error: ${resp.status} ${resp.statusText}`);

        const data = await resp.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return mcpError(`Network error reaching bot "${args.bot}": ${msg}`);
      }
    },
  );

  // --- list tool ---
  server.tool(
    "list",
    "List all available mecha bots with their status",
    {},
    async () => {
      try {
        const bots = await docker.list();
        if (bots.length === 0) {
          return { content: [{ type: "text" as const, text: "No bots running. Use `mecha spawn` to create one." }] };
        }

        const rows = bots.map((b) => ({
          name: b.name, status: b.status, model: b.model,
        }));

        return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return mcpError(`Error listing bots: ${msg}`);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
