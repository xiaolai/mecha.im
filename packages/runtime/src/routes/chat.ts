import type { FastifyInstance } from "fastify";

export function registerChatRoutes(
  app: FastifyInstance,
): void {
  // Placeholder — real chat will be handled by Claude Agent SDK.
  // The SDK writes transcripts to the projects dir naturally.
  app.post("/api/chat", async (_request, reply) => {
    reply.code(501).send({ error: "Chat is handled by Claude Agent SDK — not implemented in runtime" });
  });
}
