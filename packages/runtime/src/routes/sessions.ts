import type { FastifyInstance } from "fastify";
import type { SessionManager } from "../session-manager.js";

export function registerSessionRoutes(
  app: FastifyInstance,
  sm: SessionManager,
): void {
  // List sessions
  app.get("/api/sessions", async () => {
    return sm.list();
  });

  // Create session
  app.post<{ Body: { title?: string } }>("/api/sessions", async (request) => {
    const body = request.body ?? /* v8 ignore start */ {} /* v8 ignore stop */;
    const { title } = body;
    return sm.create({ title });
  });

  // Get session
  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id",
    async (request, reply) => {
      const session = sm.get(request.params.id);
      if (!session) {
        reply.code(404).send({ error: "Session not found" });
        return;
      }
      return session;
    },
  );

  // Delete session
  app.delete<{ Params: { id: string } }>(
    "/api/sessions/:id",
    async (request, reply) => {
      const deleted = sm.delete(request.params.id);
      if (!deleted) {
        reply.code(404).send({ error: "Session not found" });
        return;
      }
      reply.code(204).send();
    },
  );

  // Rename session
  app.patch<{ Params: { id: string }; Body: { title: string } }>(
    "/api/sessions/:id",
    async (request, reply) => {
      const { title } = request.body;
      const updated = sm.rename(request.params.id, title);
      if (!updated) {
        reply.code(404).send({ error: "Session not found" });
        return;
      }
      return { ok: true };
    },
  );

  // Star/unstar session
  app.put<{ Params: { id: string }; Body: { starred: boolean } }>(
    "/api/sessions/:id/star",
    async (request, reply) => {
      const { starred } = request.body;
      const updated = sm.star(request.params.id, starred);
      if (!updated) {
        reply.code(404).send({ error: "Session not found" });
        return;
      }
      return { ok: true };
    },
  );

  // Append message
  app.post<{
    Params: { id: string };
    Body: { role: "user" | "assistant"; content: string };
  }>("/api/sessions/:id/message", async (request, reply) => {
    const session = sm.get(request.params.id);
    if (!session) {
      reply.code(404).send({ error: "Session not found" });
      return;
    }
    if (sm.isBusy(request.params.id)) {
      reply.code(409).send({ error: "Session is busy" });
      return;
    }

    const msg = {
      role: request.body.role,
      content: request.body.content,
      timestamp: new Date().toISOString(),
    };
    sm.appendMessage(request.params.id, msg);
    return msg;
  });

  // Interrupt session
  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/interrupt",
    async (request, reply) => {
      if (!sm.isBusy(request.params.id)) {
        reply.code(409).send({ error: "Session is not busy" });
        return;
      }
      sm.setBusy(request.params.id, false);
      return { ok: true };
    },
  );
}
