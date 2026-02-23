/* v8 ignore start — transport plumbing; covered by integration tests */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { MeshMcpHandle } from "./server.js";

export const DEFAULT_MCP_HTTP_PORT = 7670;

export async function runStdio(handle: MeshMcpHandle): Promise<void> {
  const transport = new StdioServerTransport();
  await handle.mcpServer.connect(transport);
}

export async function runHttp(
  handle: MeshMcpHandle,
  opts: { port?: number; host?: string } = {},
): Promise<{ close: () => Promise<void> }> {
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );
  const { randomUUID } = await import("node:crypto");
  const { default: Fastify } = await import("fastify");

  const port = opts.port ?? DEFAULT_MCP_HTTP_PORT;
  const host = opts.host ?? "127.0.0.1";
  const app = Fastify();

  const sessions = new Map<string, { transport: InstanceType<typeof StreamableHTTPServerTransport>; lastAccess: number }>();
  const SESSION_TTL_MS = 30 * 60 * 1000;

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.post("/mcp", async (req: any, reply: any) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: InstanceType<typeof StreamableHTTPServerTransport>;

    if (sessionId && sessions.has(sessionId)) {
      const entry = sessions.get(sessionId)!;
      entry.lastAccess = Date.now();
      transport = entry.transport;
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      await handle.mcpServer.connect(transport);
      const newSessionId = transport.sessionId;
      if (newSessionId) {
        sessions.set(newSessionId, { transport, lastAccess: Date.now() });
        transport.onclose = () => sessions.delete(newSessionId);
      }
    }

    await transport.handleRequest(req.raw, reply.raw, req.body);
    reply.hijack();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.get("/mcp", async (req: any, reply: any) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      return reply.code(400).send({ error: "Invalid or missing session ID" });
    }
    const entry = sessions.get(sessionId)!;
    entry.lastAccess = Date.now();
    await entry.transport.handleRequest(req.raw, reply.raw);
    reply.hijack();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.delete("/mcp", async (req: any, reply: any) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      return reply.code(404).send({ error: "Session not found" });
    }
    const entry = sessions.get(sessionId)!;
    await entry.transport.handleRequest(req.raw, reply.raw);
    reply.hijack();
  });

  await app.listen({ port, host });

  return {
    close: async () => {
      clearInterval(cleanupTimer);
      for (const [, entry] of sessions) {
        entry.transport.close?.();
      }
      sessions.clear();
      await app.close();
    },
  };
}
/* v8 ignore stop */
