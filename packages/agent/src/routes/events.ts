import type { FastifyInstance } from "fastify";
import type { ProcessManager } from "@mecha/process";

export function registerEventRoutes(app: FastifyInstance, pm: ProcessManager): void {
  app.get("/events", async (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    /* v8 ignore start -- SSE callbacks not testable via inject */
    const unsubscribe = pm.onEvent((event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    req.socket.on("close", () => {
      unsubscribe();
      reply.raw.end();
    });
    /* v8 ignore stop */

    // Keep the connection open — Fastify won't auto-end a raw response
    return reply;
  });
}
