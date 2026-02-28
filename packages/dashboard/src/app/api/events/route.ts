import { getProcessManager, log } from "@/lib/pm-singleton";

export const dynamic = "force-dynamic";

const MAX_CONNECTIONS = 10;
const HEARTBEAT_INTERVAL_MS = 15_000;
let activeConnections = 0;

export async function GET(): Promise<Response> {
  let pm;
  try {
    pm = getProcessManager();
  } catch (err) {
    return new Response(JSON.stringify({ error: "Dashboard not initialized" }), {
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

  let cleanedUp = false;
  let cleanupFn: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const unsubscribe = pm.onEvent((event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream closed — cleanup handled by cancel()
        }
      });

      controller.enqueue(encoder.encode(": heartbeat\n\n"));

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
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
        log.info("GET /api/events", "SSE connection closed", { activeConnections });
      }

      cleanupFn = cleanup;
    },
    cancel() {
      cleanupFn?.();
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
