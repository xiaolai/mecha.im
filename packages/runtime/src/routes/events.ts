import type { FastifyInstance, FastifyReply } from "fastify";
import type { ActivityEmitter, ActivityState } from "../activity.js";

/** Options for bot-level activity events SSE route. */
export interface ActivityEventsRouteOpts {
  activityEmitter: ActivityEmitter;
  botName: string;
}

const MAX_CONNECTIONS = 6; // 5 clients + 1 reserved for daemon aggregator
const HEARTBEAT_INTERVAL_MS = 10_000;

/** Register GET /api/events SSE endpoint + GET /api/events/snapshot for bot activity. */
export function registerActivityEventsRoutes(app: FastifyInstance, opts: ActivityEventsRouteOpts): void {
  let activeConnections = 0;

  // Scoped per registration (not module-global) to avoid test state leakage
  let currentActivity: ActivityState = "idle";

  // Track current activity for snapshot
  opts.activityEmitter.subscribe((event) => {
    if (event.name === opts.botName) {
      currentActivity = event.activity;
    }
  });

  // Snapshot endpoint (non-SSE, testable via inject)
  app.get("/api/events/snapshot", async () => ({
    name: opts.botName,
    activity: currentActivity,
    timestamp: new Date().toISOString(),
  }));

  /* v8 ignore start -- SSE handler uses reply.hijack() which prevents Fastify inject testing */
  app.get("/api/events", async (request, reply: FastifyReply) => {
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

    // Send initial snapshot
    const snapshot = {
      type: "snapshot" as const,
      name: opts.botName,
      activity: currentActivity,
      timestamp: new Date().toISOString(),
    };
    reply.raw.write(`data: ${JSON.stringify(snapshot)}\n\n`);

    const unsubscribe = opts.activityEmitter.subscribe((event) => {
      if (event.name !== opts.botName) return;
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

    // Use request.socket.on("close") — NOT req.raw.on("close")
    // See AGENTS.md: SSE Streaming: Client Disconnect Detection
    request.socket.on("close", () => {
      cleanup();
    });

    await reply.hijack();
  });
  /* v8 ignore stop */
}
