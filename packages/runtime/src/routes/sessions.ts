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
}
