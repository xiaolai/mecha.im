import type { FastifyRequest, FastifyReply } from "fastify";
import { safeCompare } from "@mecha/core";

/** Create a Fastify onRequest hook that validates Bearer token auth (skips /healthz). */
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
