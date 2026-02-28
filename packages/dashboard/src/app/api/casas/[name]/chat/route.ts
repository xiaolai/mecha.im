import { MechaError, casaName } from "@mecha/core";
import { casaChat } from "@mecha/service";
import { getProcessManager, log } from "@/lib/pm-singleton";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_LENGTH = 100_000; // 100 KB

export async function POST(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const { name: raw } = await params;

  let validName;
  try {
    validName = casaName(raw);
  } catch {
    return new Response(JSON.stringify({ error: `Invalid CASA name: ${raw}` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

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

  let body: { message: string; sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.message || typeof body.message !== "string") {
    return new Response(JSON.stringify({ error: "message is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (body.message.length > MAX_MESSAGE_LENGTH) {
    return new Response(JSON.stringify({ error: `message exceeds ${MAX_MESSAGE_LENGTH} character limit` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const iter = await casaChat(pm, validName, {
      message: body.message,
      sessionId: body.sessionId,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of iter) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
          controller.close();
        } catch (err) {
          log.error("POST /api/casas/[name]/chat", "Chat stream error", err);
          const msg = err instanceof Error ? err.message : "Stream error";
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", content: msg })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    log.error("POST /api/casas/[name]/chat", "Failed to start chat", err);
    if (err instanceof MechaError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
