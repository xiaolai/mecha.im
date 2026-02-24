import type { FastifyRequest, FastifyReply } from "fastify";

export function createAuthHook(token: string) {
  return async function authHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Skip auth for health check
    if (request.url === "/healthz") return;

    const authHeader = request.headers.authorization;
    if (!authHeader) {
      reply.code(401).send({ error: "Missing Authorization header" });
      return reply;
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer" || parts[1] !== token) {
      reply.code(401).send({ error: "Invalid token" });
      return reply;
    }
  };
}
