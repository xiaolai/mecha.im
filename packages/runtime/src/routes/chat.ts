import type { FastifyInstance } from "fastify";

/** Function that handles a chat message and returns a response. */
export interface HttpChatFn {
  (message: string, sessionId?: string, signal?: AbortSignal): Promise<{
    response: string;
    sessionId: string;
    durationMs: number;
    costUsd: number;
  }>;
}

/** Register POST /api/chat route backed by a chat function. */
export function registerChatRoutes(
  app: FastifyInstance,
  chatFn: HttpChatFn,
): void {
  /** Default chat timeout: 10 minutes (SDK queries can take minutes for complex tasks). */
  const CHAT_TIMEOUT_MS = 10 * 60 * 1000;
  /** Max allowed message size: 64 KB. */
  const MAX_MESSAGE_BYTES = 65_536;

  app.post<{
    Body: { message: string; sessionId?: string };
  }>("/api/chat", async (request, reply) => {
    /* v8 ignore start -- Fastify always parses body; ?? {} is a defensive guard */
    const { message, sessionId } = request.body ?? {};
    /* v8 ignore stop */

    if (!message || typeof message !== "string") {
      return reply.code(400).send({ error: "message is required" });
    }
    if (Buffer.byteLength(message, "utf8") > MAX_MESSAGE_BYTES) {
      return reply.code(413).send({ error: "message too large" });
    }

    if (sessionId !== undefined && typeof sessionId !== "string") {
      return reply.code(400).send({ error: "sessionId must be a string" });
    }

    try {
      const result = await chatFn(
        message,
        sessionId,
        AbortSignal.timeout(CHAT_TIMEOUT_MS),
      );
      return reply.send(result);
    } catch (err) {
      const internal = err instanceof Error ? err.message : String(err);
      request.log.error({ err: internal }, "Chat request failed");

      // Detect timeout/abort before other classifications
      const isTimeout = err instanceof Error && (
        err.name === "TimeoutError" || err.name === "AbortError"
      );
      if (isTimeout) {
        return reply.code(504).send({ error: "Chat request timed out" });
      }

      // SDK query() throws plain Error — detect auth failures by known prefixes.
      // Case-insensitive matching on known SDK error signatures (R5-005).
      const msg = err instanceof Error ? err.message.toLowerCase() : "";
      const isAuthError = (
        msg.startsWith("no api credentials") ||
        msg.startsWith("anthropic_api_key") ||
        msg.startsWith("authentication failed")
      );
      const status = isAuthError ? 401 : 500;
      const clientMsg = isAuthError
        ? "Missing API credentials — configure auth for this bot"
        : "Chat request failed";
      return reply.code(status).send({ error: clientMsg });
    }
  });
}
