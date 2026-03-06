import type { FastifyInstance, FastifyReply } from "fastify";
import type { ProcessManager } from "@mecha/process";

/** Options for SSE event stream route registration. */
export interface EventsRouteOpts {
  processManager: ProcessManager;
}

const MAX_CONNECTIONS = 10;
const HEARTBEAT_INTERVAL_MS = 10_000;

/** Register GET /events SSE endpoint for real-time process lifecycle events. */
export function registerEventsRoutes(app: FastifyInstance, opts: EventsRouteOpts): void {
  // Scope connection counter to this server instance (not module-global)
  let activeConnections = 0;

  /* v8 ignore start -- SSE handler uses reply.hijack() which prevents Fastify inject testing */
  app.get("/events", async (_request, reply: FastifyReply) => {
    if (activeConnections >= MAX_CONNECTIONS) {
      reply.code(429).send({ error: "Too many SSE connections" });
      return;
    }

    activeConnections++;
    let cleanedUp = false;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    // Initial heartbeat
    reply.raw.write(": heartbeat\n\n");

    const unsubscribe = opts.processManager.onEvent((event) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        cleanup();
      }
    });

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(": heartbeat\n\n");
      } catch {
        cleanup();
      }
    }, HEARTBEAT_INTERVAL_MS);

    function cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      unsubscribe();
      clearInterval(heartbeat);
      activeConnections--;
    }

    // Use req.socket.on("close") — NOT req.raw.on("close")
    // See AGENTS.md: SSE Streaming: Client Disconnect Detection
    _request.socket.on("close", () => {
      cleanup();
    });

    // Prevent Fastify from closing the response
    await reply.hijack();
  });
  /* v8 ignore stop */
}
