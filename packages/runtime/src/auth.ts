import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function createAuthHook(token: string) {
  return async function authHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Skip auth for health check — match path ignoring query string
    const pathname = request.url.split("?")[0];
    if (pathname === "/healthz") return;

    const authHeader = request.headers.authorization;
    if (!authHeader) {
      reply.code(401).send({ error: "Missing Authorization header" });
      return reply;
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer" || !safeCompare(parts[1]!, token)) {
      reply.code(401).send({ error: "Invalid token" });
      return reply;
    }
  };
}
