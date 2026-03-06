import type { FastifyInstance } from "fastify";
import type { SessionManager } from "../session-manager.js";

/** Register session CRUD routes: GET/DELETE /api/sessions and GET/DELETE /api/sessions/:id. */
export function registerSessionRoutes(
  app: FastifyInstance,
  sm: SessionManager,
): void {
  // List sessions
  app.get("/api/sessions", async () => {
    return sm.list();
  });

  // Get session (includes transcript events)
  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id",
    async (request, reply) => {
      const session = await sm.get(request.params.id);
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
      try {
        const removed = sm.delete(request.params.id);
        if (!removed) {
          reply.code(404).send({ error: "Session not found" });
          return;
        }
        return { ok: true };
      /* v8 ignore start -- filesystem error during delete */
      } catch (err) {
        reply.code(500).send({ error: `Delete failed: ${err instanceof Error ? err.message : String(err)}` });
      }
      /* v8 ignore stop */
    },
  );
}
