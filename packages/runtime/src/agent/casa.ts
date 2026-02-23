import type { FastifyInstance } from "fastify";
import type { MechaId } from "@mecha/core";

export interface AgentOptions {
  mechaId: MechaId;
  workingDirectory?: string;
  permissionMode?: "default" | "plan" | "full-auto";
}

export type SdkPermissionMode = "acceptEdits" | "plan" | "default";
export const PERMISSION_MAP: Record<string, SdkPermissionMode> = { "full-auto": "acceptEdits", plan: "plan", default: "default" };

/**
 * Register agent chat routes on Fastify.
 *
 * POST /api/chat — send a message to the CASA agent and stream back responses.
 * Request body: { message: string, history?: Array<{ role, content }> }
 * Response: newline-delimited JSON stream of SDKMessage events.
 */
export function registerAgentRoutes(
  app: FastifyInstance,
  agentOpts?: AgentOptions,
): void {
  app.post("/api/chat", async (req, reply) => {
    const body = req.body as { message?: string } | null;
    if (!body?.message) {
      return reply.code(400).send({ error: "Missing 'message' field" });
    }

    // If no agent options configured, the SDK isn't available
    if (!agentOpts) {
      return reply.code(503).send({
        error: "Agent not configured",
        detail: "Run 'claude setup-token' inside the container to configure Claude auth",
      });
    }

    try {
      // Dynamically import the Agent SDK to avoid hard failure when not available
      const { query } = await import("@anthropic-ai/claude-agent-sdk");

      const abortController = new AbortController();

      /* v8 ignore start — SSE streaming including socket handler; integration-tested */
      // Clean up if client disconnects (use socket close, not req.raw close which fires on body consumption)
      req.socket.on("close", () => { abortController.abort(); });

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      reply.hijack();
      const stream = query({
        prompt: body.message,
        options: {
          abortController,
          cwd: agentOpts.workingDirectory ?? process.cwd(),
          permissionMode: PERMISSION_MAP[agentOpts.permissionMode ?? "default"] ?? "default",
        },
      });

      for await (const message of stream) {
        if (abortController.signal.aborted) break;

        // Send each message as an SSE event
        const data = JSON.stringify(message);
        reply.raw.write(`data: ${data}\n\n`);
      }

      reply.raw.write("data: [DONE]\n\n");
      reply.raw.end();
    } catch (err) {
      if (!reply.raw.headersSent) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return reply.code(500).send({ error: message });
      }
      reply.raw.end();
      /* v8 ignore stop */
    }
  });
}
