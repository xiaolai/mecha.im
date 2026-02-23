import { type NextRequest } from "next/server";
import { mechaSessionMessage, agentFetch } from "@mecha/service";
import { SessionNotFoundError, SessionBusyError, toHttpStatus, toSafeMessage } from "@mecha/contracts";
import { getDockerClient } from "@/lib/docker";
import { withStreamAuth } from "@/lib/api-auth";
import { resolveNodeTarget } from "@/lib/resolve-node";

export const POST = withStreamAuth(async (
  request: NextRequest,
  { params }: { params: Promise<Record<string, string>> },
): Promise<Response> => {
  const { id, sessionId } = await params;
  const client = getDockerClient();

  let body: { message?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const MAX_MESSAGE_LENGTH = 100_000;
  const message = body.message ?? "";
  if (!message) {
    return new Response(JSON.stringify({ error: "Message is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return new Response(JSON.stringify({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const target = resolveNodeTarget(request);

    if (target.node !== "local" && target.entry) {
      // Remote: relay SSE stream through the agent
      const sid = encodeURIComponent(sessionId);
      const res = await agentFetch(target.entry, `/mechas/${id}/sessions/${sid}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        timeoutMs: 0, // SSE streams are long-lived — no timeout
      });

      return new Response(res.body, {
        headers: {
          "Content-Type": res.headers.get("Content-Type") ?? "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Local: direct call
    const res = await mechaSessionMessage(client, { id, sessionId, message }, request.signal);

    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    if (err instanceof SessionNotFoundError || err instanceof SessionBusyError) {
      return new Response(JSON.stringify({ error: toSafeMessage(err) }), {
        status: toHttpStatus(err),
        headers: { "Content-Type": "application/json" },
      });
    }
    throw err;
  }
});
