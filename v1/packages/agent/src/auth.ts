import type { FastifyRequest, FastifyReply } from "fastify";

export function createBearerAuth(apiKey: string) {
  return async function bearerAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/healthz") return;

    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      reply.code(401).send({ error: "Missing or invalid Authorization header" });
      return;
    }

    const token = header.slice(7);
    if (token !== apiKey) {
      reply.code(401).send({ error: "Invalid API key" });
      return;
    }
  };
}
