import type { FastifyInstance } from "fastify";
import type { SessionManager } from "./session-manager.js";
import {
  SessionNotFoundError,
  SessionBusyError,
  SessionConfig,
  toHttpStatus,
  toSafeMessage,
} from "@mecha/contracts";

export function registerSessionRoutes(
  app: FastifyInstance,
  sessionManager: SessionManager | undefined,
  projectDir?: string,
): void {
  // If no session manager, all routes return 503
  if (!sessionManager) {
    const unavailable = async (_req: unknown, reply: { code: (n: number) => { send: (body: unknown) => unknown } }) =>
      reply.code(503).send({ error: "Sessions not available" });
    app.post("/api/sessions", unavailable);
    app.get("/api/sessions", unavailable);
    app.get("/api/sessions/:id", unavailable);
    app.delete("/api/sessions/:id", unavailable);
    app.post("/api/sessions/:id/message", unavailable);
    app.post("/api/sessions/:id/interrupt", unavailable);
    app.put("/api/sessions/:id/config", unavailable);
    app.patch("/api/sessions/:id", unavailable);
    app.post("/api/sessions/import", unavailable);
    return;
  }

  const sm = sessionManager;

  // POST /api/sessions/import — import JSONL transcripts
  app.post("/api/sessions/import", async (_req, reply) => {
    if (!projectDir) return reply.code(400).send({ error: "No project directory configured" });
    const imported = sm.importTranscripts(projectDir);
    return reply.send({ imported });
  });

  // POST /api/sessions — create session
  app.post("/api/sessions", async (req, reply) => {
    try {
      const body = (req.body ?? {}) as { title?: string; config?: unknown };
      let config;
      if (body.config) {
        const parsed = SessionConfig.safeParse(body.config);
        if (!parsed.success) {
          return reply.code(400).send({ error: "Invalid config", details: parsed.error.issues });
        }
        config = parsed.data;
      }
      const session = sm.create({ title: body.title, config });
      return reply.code(201).send(session);
    } catch (err) {
      return reply.code(toHttpStatus(err)).send({ error: toSafeMessage(err) });
    }
  });

  // GET /api/sessions — list sessions
  app.get("/api/sessions", async (_req, reply) => {
    const sessions = sm.list();
    return reply.send(sessions);
  });

  // GET /api/sessions/:id — get session detail
  app.get("/api/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Math.max(parseInt(query.limit ?? "50", 10) || 50, 1), 200);
    const offset = Math.max(parseInt(query.offset ?? "0", 10) || 0, 0);

    const session = sm.get(id, limit, offset);
    if (!session) {
      return reply.code(404).send({ error: `Session not found: ${id}` });
    }
    return reply.send(session);
  });

  // DELETE /api/sessions/:id — delete session
  app.delete("/api/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = sm.delete(id);
    if (!deleted) {
      return reply.code(404).send({ error: `Session not found: ${id}` });
    }
    return reply.code(204).send();
  });

  // PATCH /api/sessions/:id — rename session
  app.patch("/api/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { title?: string } | null;
    if (!body || typeof body.title !== "string" || !body.title.trim()) {
      return reply.code(400).send({ error: "Missing 'title' field" });
    }
    try {
      const session = sm.rename(id, body.title);
      return reply.send(session);
    } catch (err) {
      return reply.code(toHttpStatus(err)).send({ error: toSafeMessage(err) });
    }
  });

  // POST /api/sessions/:id/message — send message (SSE stream)
  app.post("/api/sessions/:id/message", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { message?: string } | null;
    if (!body?.message || typeof body.message !== "string") {
      return reply.code(400).send({ error: "Missing 'message' field" });
    }
    if (body.message.length > 100_000) {
      return reply.code(400).send({ error: "Message too long (max 100000 characters)" });
    }

    // Use an explicit iterator so we can:
    // 1. Pull the first value to trigger the atomic session check BEFORE SSE headers
    // 2. Guarantee cleanup (it.return()) on all exit paths via finally
    const it = sm.sendMessage(id, body.message)[Symbol.asyncIterator]();

    let firstResult: IteratorResult<unknown>;
    try {
      firstResult = await it.next();
    /* v8 ignore start — catch block: SessionNotFoundError and SessionBusyError tested; generic error requires real SDK */
    } catch (err) {
      if (err instanceof SessionNotFoundError || err instanceof SessionBusyError) {
        return reply.code(toHttpStatus(err)).send({ error: toSafeMessage(err) });
      }
      return reply.code(500).send({ error: "Internal error" });
    }
    /* v8 ignore stop */

    try {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      reply.hijack();

      // Detect client disconnect via socket close (not req.raw close which fires on body consumption)
      let clientDisconnected = false;
      /* v8 ignore start — socket close callback is integration-tested */
      req.socket.on("close", () => { clientDisconnected = true; });
      /* v8 ignore stop */

      // Emit session event at stream start
      reply.raw.write(`data: ${JSON.stringify({ type: "session", session_id: id })}\n\n`);

      // Write the first message we already consumed, then drain remaining
      let result = firstResult;
      while (!result.done) {
        /* v8 ignore start — clientDisconnected requires real TCP disconnect */
        if (clientDisconnected) break;
        /* v8 ignore stop */
        reply.raw.write(`data: ${JSON.stringify(result.value)}\n\n`);
        result = await it.next();
      }

      // Ensure iterator cleanup on all exit paths (normal completion, client disconnect break)
      // This triggers sendMessage's finally block which marks the session idle.
      await it.return?.();

      reply.raw.write("data: [DONE]\n\n");
      reply.raw.end();
    /* v8 ignore start — streaming error handler requires real socket errors */
    } catch (err) {
      // Ensure iterator cleanup so sendMessage finally block runs (marks session idle)
      await it.return?.();
      if (!reply.raw.headersSent) {
        return reply.code(500).send({ error: "Internal error" });
      }
      // If headers already sent (streaming), send error event and close
      reply.raw.write(`data: ${JSON.stringify({ type: "error", error: toSafeMessage(err) })}\n\n`);
      reply.raw.write("data: [DONE]\n\n");
      reply.raw.end();
    }
    /* v8 ignore stop */
  });

  // POST /api/sessions/:id/interrupt — interrupt session
  app.post("/api/sessions/:id/interrupt", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const interrupted = sm.interrupt(id);
      return reply.send({ interrupted });
    } catch (err) {
      return reply.code(toHttpStatus(err)).send({ error: toSafeMessage(err) });
    }
  });

  // PUT /api/sessions/:id/config — update session config
  app.put("/api/sessions/:id/config", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = SessionConfig.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid config", details: parsed.error.issues });
    }
    try {
      const detail = sm.updateConfig(id, parsed.data);
      return reply.send({ sessionId: detail.sessionId, config: detail.config });
    } catch (err) {
      return reply.code(toHttpStatus(err)).send({ error: toSafeMessage(err) });
    }
  });
}
