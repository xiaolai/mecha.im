import type { FastifyRequest, FastifyReply } from "fastify";

export interface AuthOpts {
  apiKey: string;
}

/**
 * Fastify onRequest hook that validates Bearer token.
 * Extracts X-Mecha-Source header for inter-node identification.
 */
export function createAuthHook(opts: AuthOpts) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Healthz is public
    if (request.url === "/healthz") return;

    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ") || auth.slice(7) !== opts.apiKey) {
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
