import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolve, relative } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import type { SessionManager } from "../agent/session-manager.js";

const WORKSPACE_ROOT = process.env["MECHA_WORKSPACE"] ?? process.cwd();
const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Resolve a user-provided path safely within /workspace. */
function safePath(userPath: string): string {
  const resolved = resolve(WORKSPACE_ROOT, userPath);
  const rel = relative(WORKSPACE_ROOT, resolved);
  if (rel.startsWith("..") || !resolved.startsWith(WORKSPACE_ROOT)) {
    throw new Error("Path traversal detected: access denied");
  }
  return resolved;
}

function textContent(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], ...(isError && { isError: true }) };
}

export interface McpServerHandle {
  mcpServer: McpServer;
}

export interface CreateMcpServerOptions {
  mechaId: string;
  sessionManager?: SessionManager;
}

/**
 * Create and configure an MCP server with default tools.
 */
export function createMcpServer(opts: CreateMcpServerOptions): McpServerHandle {
  const mcpServer = new McpServer(
    { name: `mecha-${opts.mechaId}`, version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // Register built-in tools
  registerDefaultTools(mcpServer, opts.sessionManager);

  return { mcpServer };
}

/**
 * Register MCP routes on Fastify using StreamableHTTPServerTransport.
 * Each session gets its own transport (stateful mode).
 */
/* v8 ignore start — HTTP transport plumbing; covered by integration tests */
export function registerMcpRoutes(
  app: FastifyInstance,
  handle: McpServerHandle,
): void {
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; lastAccess: number }>();

  /* v8 ignore start — timer callbacks and onClose hooks are integration-tested */
  // Periodic cleanup of idle sessions
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [sid, entry] of sessions) {
      if (now - entry.lastAccess > SESSION_TTL_MS) {
        entry.transport.close?.();
        sessions.delete(sid);
      }
    }
  }, 60_000);
  cleanupTimer.unref();

  // Clean up on server close
  app.addHook("onClose", async () => {
    clearInterval(cleanupTimer);
    for (const [, entry] of sessions) {
      entry.transport.close?.();
    }
    sessions.clear();
  });
  /* v8 ignore stop */

  const getSessionId = (req: { headers: Record<string, string | string[] | undefined> }) =>
    (req.headers["mcp-session-id"] as string) || undefined;

  // POST /mcp — main MCP endpoint
  app.post("/mcp", async (req, reply) => {
    const sessionId = getSessionId(req);
    let transport: StreamableHTTPServerTransport;

    if (sessionId && sessions.has(sessionId)) {
      /* v8 ignore next 3 — session reuse requires real HTTP (not inject) */
      const entry = sessions.get(sessionId)!;
      entry.lastAccess = Date.now();
      transport = entry.transport;
    } else {
      // Enforce session cap
      /* v8 ignore next 3 — session cap requires filling 100 real MCP sessions */
      if (sessions.size >= MAX_SESSIONS) {
        return reply.code(429).send({ error: "Too many active sessions" });
      }

      // New session
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      await handle.mcpServer.connect(transport);

      // Extract session ID from transport after connect
      const newSessionId = transport.sessionId;
      /* v8 ignore next 5 — transport internals, integration-tested */
      if (newSessionId) {
        sessions.set(newSessionId, { transport, lastAccess: Date.now() });
        transport.onclose = () => {
          sessions.delete(newSessionId);
        };
      }
    }

    // Forward the raw Node.js request/response to the transport
    await transport.handleRequest(req.raw, reply.raw, req.body);

    // Mark reply as sent since we wrote directly to raw response
    reply.hijack();
  });

  // GET /mcp — SSE stream for server-to-client notifications
  app.get("/mcp", async (req, reply) => {
    const sessionId = getSessionId(req);
    if (!sessionId || !sessions.has(sessionId)) {
      return reply.code(400).send({ error: "Invalid or missing session ID" });
    }

    /* v8 ignore start — valid-session GET/DELETE requires real HTTP transport */
    const entry = sessions.get(sessionId)!;
    entry.lastAccess = Date.now();
    await entry.transport.handleRequest(req.raw, reply.raw);
    reply.hijack();
    /* v8 ignore stop */
  });

  // DELETE /mcp — close session
  app.delete("/mcp", async (req, reply) => {
    const sessionId = getSessionId(req);
    if (!sessionId || !sessions.has(sessionId)) {
      return reply.code(404).send({ error: "Session not found" });
    }

    /* v8 ignore start */
    const entry = sessions.get(sessionId)!;
    await entry.transport.handleRequest(req.raw, reply.raw);
    reply.hijack();
    /* v8 ignore stop */
  });
}
/* v8 ignore stop */

/**
 * Collect text from a session sendMessage stream.
 * Extracts text content blocks from assistant messages.
 */
async function collectStreamText(stream: AsyncIterable<unknown>): Promise<string> {
  const parts: string[] = [];
  for await (const msg of stream) {
    const sdkMsg = msg as Record<string, unknown>;
    if (sdkMsg.type === "assistant" && sdkMsg.message) {
      const content = (sdkMsg.message as Record<string, unknown>).content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string") {
            parts.push(block.text);
          }
        }
      }
    }
  }
  return parts.join("");
}

/**
 * Register default MCP tools for a Mecha runtime.
 */
function registerDefaultTools(mcpServer: McpServer, sessionManager?: SessionManager): void {
  mcpServer.tool("mecha_status", "Get the current status of this Mecha instance", {}, async () =>
    textContent(JSON.stringify({ status: "running", timestamp: new Date().toISOString() })),
  );

  mcpServer.tool(
    "mecha_workspace_list",
    "List files in the Mecha workspace",
    { path: z.string().optional().describe("Subdirectory path within the workspace") },
    async ({ path }) => {
      let targetPath: string;
      try { targetPath = path ? safePath(path) : WORKSPACE_ROOT; }
      catch { return textContent("Error: path traversal denied", true); }
      try {
        const entries = await readdir(targetPath, { withFileTypes: true });
        /* v8 ignore next */
        return textContent(JSON.stringify(entries.map((e) => ({ name: e.name, type: e.isDirectory() ? "directory" : "file" }))));
      } catch { return textContent(`Error: cannot read ${targetPath}`, true); }
    },
  );

  mcpServer.tool(
    "mecha_workspace_read",
    "Read a file from the Mecha workspace",
    { path: z.string().describe("File path relative to the workspace") },
    async ({ path: filePath }) => {
      let resolvedPath: string;
      try { resolvedPath = safePath(filePath); }
      catch { return textContent("Error: path traversal denied", true); }
      try { return textContent(await readFile(resolvedPath, "utf-8")); }
      catch { return textContent(`Error: cannot read ${filePath}`, true); }
    },
  );

  // --- Agent interaction tools (require SessionManager) ---

  mcpServer.tool(
    "mecha_chat",
    "Send a message to the Claude agent running in this Mecha",
    { message: z.string().describe("The message to send to the agent") },
    async ({ message }) => {
      if (!sessionManager) return textContent("Sessions not available", true);
      let sessionId: string | undefined;
      try {
        const session = sessionManager.create({ title: `MCP chat ${new Date().toISOString()}` });
        sessionId = session.sessionId;
        const text = await collectStreamText(sessionManager.sendMessage(sessionId, message));
        return textContent(text || "(no response)");
      } catch (err) {
        return textContent(`Chat request failed: ${err instanceof Error ? err.message : String(err)}`, true);
      } finally {
        if (sessionId) try { sessionManager.delete(sessionId); } catch { /* best effort */ }
      }
    },
  );

  // --- Session management tools ---

  mcpServer.tool(
    "mecha_session_list",
    "List all conversation sessions",
    {},
    async () => {
      if (!sessionManager) return textContent("Sessions not available", true);
      try {
        return textContent(JSON.stringify(sessionManager.list()));
      } catch (err) {
        return textContent(`Request failed: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
  );

  mcpServer.tool(
    "mecha_session_create",
    "Create a new conversation session",
    { title: z.string().optional().describe("Optional title for the session") },
    async ({ title }) => {
      if (!sessionManager) return textContent("Sessions not available", true);
      try {
        const session = sessionManager.create({ title });
        return textContent(JSON.stringify(session));
      } catch (err) {
        return textContent(`Request failed: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
  );

  mcpServer.tool(
    "mecha_session_message",
    "Send a message within a specific session",
    {
      sessionId: z.string().describe("The session ID to send the message to"),
      message: z.string().describe("The message to send"),
    },
    async ({ sessionId, message }) => {
      if (!sessionManager) return textContent("Sessions not available", true);
      try {
        const text = await collectStreamText(sessionManager.sendMessage(sessionId, message));
        return textContent(text || "(no response)");
      } catch (err) {
        return textContent(`Request failed: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
  );

  mcpServer.tool(
    "mecha_session_delete",
    "Delete a conversation session",
    { sessionId: z.string().describe("The session ID to delete") },
    async ({ sessionId }) => {
      if (!sessionManager) return textContent("Sessions not available", true);
      try {
        const deleted = sessionManager.delete(sessionId);
        return textContent(JSON.stringify({ deleted, sessionId }));
      } catch (err) {
        return textContent(`Request failed: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
  );
}
