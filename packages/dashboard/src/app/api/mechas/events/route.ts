import { type NextRequest } from "next/server";
import { getProcessManager } from "@/lib/process";
import { withStreamAuth } from "@/lib/api-auth";

export const GET = withStreamAuth(async (request: NextRequest) => {
  const pm = getProcessManager();
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    start(controller) {
      const unsubscribe = pm.onEvent((event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          unsubscribe();
        }
      });

      request.signal.addEventListener("abort", () => {
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      }, { once: true });
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
