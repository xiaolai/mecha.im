import type { FastifyInstance } from "fastify";
import { DEFAULTS } from "@mecha/core";

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
  app.post<{
    Body: { message: string; sessionId?: string };
  }>("/api/chat", async (request, reply) => {
    const { message, sessionId } = request.body ?? {};

    if (!message || typeof message !== "string") {
      return reply.code(400).send({ error: "message is required" });
    }
    if (message.length > DEFAULTS.RELAY_MAX_MESSAGE_BYTES) {
      return reply.code(413).send({ error: "message too large" });
    }

    if (sessionId !== undefined && typeof sessionId !== "string") {
      return reply.code(400).send({ error: "sessionId must be a string" });
    }

    const result = await chatFn(
      message,
      sessionId,
      AbortSignal.timeout(DEFAULTS.FORWARD_TIMEOUT_MS),
    );

    return reply.send(result);
  });
}
