import { getProcessManager } from "@/lib/pm-singleton";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const pm = getProcessManager();

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

      // Store unsubscribe for cleanup
      (controller as unknown as Record<string, unknown>).__unsub = unsubscribe;
    },
    cancel(controller) {
      const unsub = (controller as unknown as Record<string, unknown>).__unsub as (() => void) | undefined;
      unsub?.();
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
