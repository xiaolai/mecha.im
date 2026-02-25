import type { FastifyRequest, FastifyReply } from "fastify";
import { timingSafeEqual } from "node:crypto";

export interface AuthOpts {
  apiKey: string;
}

/** Constant-time string comparison to prevent timing side-channel attacks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Fastify onRequest hook that validates Bearer token.
 */
export function createAuthHook(opts: AuthOpts) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Healthz is public (match pathname only, ignore query string)
    const pathname = request.url.split("?")[0];
    if (pathname === "/healthz") return;

    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ") || !safeEqual(auth.slice(7), opts.apiKey)) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
  };
}

/** Extract X-Mecha-Source header from request */
export function getSource(request: FastifyRequest): string | undefined {
  const header = request.headers["x-mecha-source"];
  return typeof header === "string" ? header : undefined;
}
