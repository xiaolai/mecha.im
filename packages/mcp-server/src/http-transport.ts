import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { safeCompare } from "@mecha/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  timer: ReturnType<typeof setTimeout>;
}

const MAX_SESSIONS = 64;
const SESSION_IDLE_MS = 30 * 60_000; // 30 minutes

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "null",
  });
  res.end(JSON.stringify(body));
}

export interface HttpTransportOpts {
  port: number;
  host: string;
  token?: string;
}

export async function runHttp(
  createMcpServer: () => McpServer,
  opts: HttpTransportOpts,
): Promise<void> {
  const sessions = new Map<string, Session>();

  function touchSession(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (!session) return;
    clearTimeout(session.timer);
    session.timer = setTimeout(() => void expireSession(sessionId), SESSION_IDLE_MS);
  }

  async function expireSession(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    /* v8 ignore start -- race: session may have been deleted between timeout fire and execution */
    if (!session) return;
    /* v8 ignore stop */
    sessions.delete(sessionId);
    await session.transport.close().catch(() => {});
    await session.server.close().catch(() => {});
  }

  async function closeAllSessions(): Promise<void> {
    const closing = [...sessions.entries()].map(async ([, s]) => {
      clearTimeout(s.timer);
      await s.transport.close();
      await s.server.close();
    });
    await Promise.allSettled(closing);
    sessions.clear();
  }

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // #7: Use fixed base URL — Host header is untrusted
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname !== "/mcp") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const method = req.method?.toUpperCase();

    // CORS preflight — deny cross-origin
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "null",
        "Access-Control-Allow-Methods": "GET, POST, DELETE",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-session-id",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }

    if (method !== "GET" && method !== "POST" && method !== "DELETE") {
      res.writeHead(405, { Allow: "GET, POST, DELETE, OPTIONS" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    // Bearer token authentication (when configured)
    if (opts.token) {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        sendJson(res, 401, { error: "Missing Authorization header" });
        return;
      }
      const parts = authHeader.split(" ");
      if (parts.length !== 2 || parts[0] !== "Bearer" || !safeCompare(parts[1]!, opts.token)) {
        sendJson(res, 401, { error: "Invalid token" });
        return;
      }
    }

    // #8: Normalize mcp-session-id — reject string[] from duplicate headers
    const rawSessionId = req.headers["mcp-session-id"];
    if (Array.isArray(rawSessionId)) {
      sendJson(res, 400, { error: "Invalid mcp-session-id header" });
      return;
    }
    const sessionId = rawSessionId;

    if (method === "POST" && !sessionId) {
      // #4: Enforce session cap
      if (sessions.size >= MAX_SESSIONS) {
        sendJson(res, 503, { error: "Too many sessions" });
        return;
      }

      let transport: StreamableHTTPServerTransport | undefined;
      let server: McpServer | undefined;
      try {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });
        server = createMcpServer();
        // #1: Guard server.connect() — catch + cleanup on failure
        await server.connect(transport);

        // #2: handleRequest first — SDK populates sessionId during initialize handling
        await transport.handleRequest(req, res);

        const newSessionId = transport.sessionId;
        /* v8 ignore start -- sessionId is always set after handleRequest with sessionIdGenerator */
        if (!newSessionId) {
          return;
        }
        /* v8 ignore stop */
        const timer = setTimeout(() => void expireSession(newSessionId), SESSION_IDLE_MS);
        sessions.set(newSessionId, { transport, server, timer });

        transport.onclose = () => {
          const s = sessions.get(newSessionId);
          if (s) clearTimeout(s.timer);
          sessions.delete(newSessionId);
        };
      } catch (err: unknown) {
        process.stderr.write(`[mecha:mcp] session create error: ${err instanceof Error ? err.message : String(err)}\n`);
        if (transport) await transport.close().catch(() => {});
        if (server) await server.close().catch(() => {});
        if (transport?.sessionId) {
          const s = sessions.get(transport.sessionId);
          if (s) clearTimeout(s.timer);
          sessions.delete(transport.sessionId);
        }
        /* v8 ignore start -- res may already be sent by handleRequest */
        if (!res.headersSent) {
          sendJson(res, 500, { error: "Internal server error" });
        }
        /* v8 ignore stop */
      }
      return;
    }

    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        sendJson(res, 404, { error: "Session not found" });
        return;
      }

      if (method === "DELETE") {
        try {
          clearTimeout(session.timer);
          await session.transport.close();
          await session.server.close();
          sessions.delete(sessionId);
          sendJson(res, 200, { ok: true });
        /* v8 ignore start -- close errors are runtime-only */
        } catch {
          sessions.delete(sessionId);
          if (!res.headersSent) {
            sendJson(res, 500, { error: "Internal server error" });
          }
        }
        /* v8 ignore stop */
        return;
      }

      touchSession(sessionId);

      // #3: Guard existing-session handleRequest
      try {
        await session.transport.handleRequest(req, res);
      } catch (err: unknown) {
        process.stderr.write(`[mecha:mcp] session ${sessionId} error: ${err instanceof Error ? err.message : String(err)}\n`);
        /* v8 ignore start -- res may already be sent */
        if (!res.headersSent) {
          sendJson(res, 500, { error: "Internal server error" });
        }
        /* v8 ignore stop */
      }
      return;
    }

    sendJson(res, 400, { error: "Missing mcp-session-id header" });
  });

  // #6: Handle listen errors (e.g. EADDRINUSE)
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(opts.port, opts.host, () => {
      httpServer.removeListener("error", reject);
      process.stderr.write(
        `MCP HTTP server listening on http://${opts.host}:${opts.port}/mcp\n`,
      );
      resolve();
    });
  });

  // #5: Shutdown — close all sessions before closing HTTP server
  let shuttingDown = false;
  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      await closeAllSessions();
      httpServer.close(() => resolve());
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
  });
}
