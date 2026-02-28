import { getProcessManager, log } from "@/lib/pm-singleton";

export const dynamic = "force-dynamic";

const unsubMap = new WeakMap<ReadableStreamDefaultController, () => void>();

const MAX_CONNECTIONS = 10;
const HEARTBEAT_INTERVAL_MS = 15_000;
let activeConnections = 0;

export async function GET(): Promise<Response> {
  let pm;
  try {
    pm = getProcessManager();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Dashboard not initialized";
    return new Response(JSON.stringify({ error: message }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (activeConnections >= MAX_CONNECTIONS) {
    return new Response(JSON.stringify({ error: "Too many SSE connections" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  activeConnections++;
  log.info("GET /api/events", "SSE connection opened", { activeConnections });

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const unsubscribe = pm.onEvent((event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream closed — unsubscribe handled by cancel()
        }
      });

      // Send initial heartbeat so the client knows the connection is live
      controller.enqueue(encoder.encode(": heartbeat\n\n"));

      // Periodic heartbeat to detect dead connections
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_INTERVAL_MS);

      // Store cleanup functions
      unsubMap.set(controller, () => {
        unsubscribe();
        clearInterval(heartbeat);
        activeConnections--;
        log.info("GET /api/events", "SSE connection closed", { activeConnections });
      });
    },
    cancel(controller) {
      const cleanup = unsubMap.get(controller);
      cleanup?.();
      unsubMap.delete(controller);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
