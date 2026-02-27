import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

const MAX_SESSIONS = 64;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export async function runHttp(
  createMcpServer: () => McpServer,
  opts: { port: number; host: string },
): Promise<void> {
  const sessions = new Map<string, Session>();

  async function closeAllSessions(): Promise<void> {
    const closing = [...sessions.values()].map(async (s) => {
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

    if (method !== "GET" && method !== "POST" && method !== "DELETE") {
      res.writeHead(405, { Allow: "GET, POST, DELETE" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
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

        const newSessionId = transport.sessionId;
        /* v8 ignore start -- sessionId is always set when sessionIdGenerator is provided */
        if (!newSessionId) {
          sendJson(res, 500, { error: "Failed to create session" });
          return;
        }
        /* v8 ignore stop */
        sessions.set(newSessionId, { transport, server });

        transport.onclose = () => {
          sessions.delete(newSessionId);
        };

        // #2: Guard handleRequest — cleanup leaked session on failure
        await transport.handleRequest(req, res);
      } catch {
        if (transport) await transport.close().catch(() => {});
        if (server) await server.close().catch(() => {});
        if (transport?.sessionId) sessions.delete(transport.sessionId);
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
        await session.transport.close();
        await session.server.close();
        sessions.delete(sessionId);
        sendJson(res, 200, { ok: true });
        return;
      }

      // #3: Guard existing-session handleRequest
      try {
        await session.transport.handleRequest(req, res);
      } catch {
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
  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      await closeAllSessions();
      httpServer.close(() => resolve());
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
  });
}
