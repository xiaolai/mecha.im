/**
 * Runtime task routes — POST /api/tasks, POST /api/tasks/:id/cancel, GET /api/tasks/:id/status
 *
 * These run inside the bot's runtime process. The agent server proxies here.
 * Execution uses sdkChat directly — real AbortController cancellation.
 */
import type { FastifyInstance } from "fastify";
import { startTask, cancelTask, isTaskRunning } from "../task-runner.js";
import type { SdkChatOpts } from "../sdk-chat.js";

/** Options for registering task routes. */
export interface TaskRouteOpts {
  sdkChatOpts: SdkChatOpts;
  botName: string;
  /** Agent server URL for result callback (e.g. http://127.0.0.1:7660). */
  agentUrl?: string;
  /** Bearer token for agent server authentication. */
  agentAuth?: string;
}

/** In-memory terminal results for recently completed tasks (ephemeral). */
const taskResults = new Map<string, { status: string; result?: string; error?: string }>();
const MAX_RESULTS = 100;

function storeResult(taskId: string, result: { status: string; result?: string; error?: string }): void {
  if (taskResults.size >= MAX_RESULTS) {
    // Evict oldest
    const oldest = taskResults.keys().next().value;
    if (oldest) taskResults.delete(oldest);
  }
  taskResults.set(taskId, result);
}

/** Register task execution routes on the bot runtime server. */
export function registerTaskRoutes(app: FastifyInstance, opts: TaskRouteOpts): void {
  /**
   * POST /api/tasks — Accept and execute a task.
   * Body: { taskId: string, message: string }
   * Returns: 202 { accepted: true }
   */
  app.post<{ Body: { taskId: string; message: string } }>("/api/tasks", async (req, reply) => {
    const { taskId, message } = req.body ?? {};
    if (!taskId || typeof taskId !== "string") {
      return reply.code(400).send({ error: "Missing required: taskId" });
    }
    if (!message || typeof message !== "string") {
      return reply.code(400).send({ error: "Missing required: message" });
    }

    const admission = startTask(taskId, opts.sdkChatOpts, message, (result) => {
      storeResult(taskId, result);
      // Callback to agent server to update persistent task storage
      /* v8 ignore start -- agent callback requires live agent process */
      if (opts.agentUrl && opts.agentAuth) {
        const callbackUrl = `${opts.agentUrl}/tasks/${encodeURIComponent(taskId)}`;
        const callbackHeaders: Record<string, string> = {
          "content-type": "application/json",
          authorization: `Bearer ${opts.agentAuth}`,
          "x-mecha-source": `${opts.botName}@local`,
        };
        const callbackBody = JSON.stringify(result);
        const doCallback = (attempt: number) => {
          void fetch(callbackUrl, {
            method: "PATCH",
            headers: callbackHeaders,
            body: callbackBody,
            signal: AbortSignal.timeout(5_000),
          }).then((res) => {
            if (!res.ok && attempt < 2) {
              setTimeout(() => doCallback(attempt + 1), 1_000);
            }
          }).catch(() => {
            if (attempt < 2) setTimeout(() => doCallback(attempt + 1), 1_000);
          });
        };
        doCallback(0);
      }
      /* v8 ignore stop */
    });

    if (!admission.admitted) {
      return reply.code(429).send({ error: admission.error ?? "Task rejected" });
    }

    return reply.code(202).send({ accepted: true, taskId });
  });

  /**
   * POST /api/tasks/:id/cancel — Cancel a running task.
   * Returns: 200 { cancelled: true } or 404
   */
  app.post<{ Params: { id: string } }>("/api/tasks/:id/cancel", async (req, reply) => {
    const { id } = req.params;
    const cancelled = cancelTask(id);
    if (!cancelled) {
      return reply.code(404).send({ error: `Task ${id} not found or not running` });
    }
    return reply.send({ cancelled: true });
  });

  /**
   * GET /api/tasks/:id/status — Check task execution status.
   * Returns: 200 { running: true } or { running: false, ...result }
   */
  app.get<{ Params: { id: string } }>("/api/tasks/:id/status", async (req, reply) => {
    const { id } = req.params;
    if (isTaskRunning(id)) {
      return reply.send({ running: true, status: "working" });
    }
    const result = taskResults.get(id);
    if (result) {
      return reply.send({ running: false, ...result });
    }
    return reply.code(404).send({ error: `Task ${id} not found` });
  });
}
