import type { FastifyInstance } from "fastify";

/** Register POST /api/chat stub route (returns 501 — chat is handled by Agent SDK). */
export function registerChatRoutes(
  app: FastifyInstance,
): void {
  // Chat is handled by Claude Agent SDK, not the runtime HTTP server.
  // The SDK writes transcripts to the projects dir naturally.
  // This stub returns 501 so callers get a clear error.
  app.post("/api/chat", async (_request, reply) => {
    reply.code(501).send({
      error: "Chat is handled by Claude Agent SDK. Use 'claude' CLI or Agent SDK directly.",
    });
  });
}
