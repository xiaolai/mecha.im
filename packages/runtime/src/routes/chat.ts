import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { SessionManager } from "../session-manager.js";

export function registerChatRoutes(
  app: FastifyInstance,
  sm: SessionManager,
): void {
  app.post<{ Body: { message: string; sessionId?: string } }>(
    "/api/chat",
    async (request: FastifyRequest<{ Body: { message: string; sessionId?: string } }>, reply: FastifyReply) => {
      const { message, sessionId } = request.body;

      // Get or create session
      const sid = sessionId ?? sm.create({ title: message.slice(0, 50) }).id;
      const session = sm.get(sid);
      if (!session) {
        reply.code(404).send({ error: "Session not found" });
        return;
      }

      if (sm.isBusy(sid)) {
        reply.code(409).send({ error: "Session is busy" });
        return;
      }

      sm.setBusy(sid, true);

      // Append user message
      sm.appendMessage(sid, {
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
      });

      // SSE response
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // Detect client disconnect via socket close (NOT req.raw.destroyed)
      let disconnected = false;
      /* v8 ignore start -- socket close only fires on real TCP disconnect */
      request.socket.on("close", () => {
        disconnected = true;
        sm.setBusy(sid, false);
      });
      /* v8 ignore stop */

      // Placeholder: echo back the message as a streaming response
      const responseContent = `Echo: ${message}`;
      const chunks = responseContent.split(" ");

      for (const chunk of chunks) {
        /* v8 ignore start */
        if (disconnected) break;
        /* v8 ignore stop */
        reply.raw.write(`data: ${JSON.stringify({ type: "text", content: chunk + " " })}\n\n`);
      }

      // Append assistant message
      sm.appendMessage(sid, {
        role: "assistant",
        content: responseContent,
        timestamp: new Date().toISOString(),
      });

      /* v8 ignore start */
      if (!disconnected) {
      /* v8 ignore stop */
        reply.raw.write(`data: ${JSON.stringify({ type: "done", sessionId: sid })}\n\n`);
        sm.setBusy(sid, false);
      }

      reply.raw.end();
    },
  );
}
