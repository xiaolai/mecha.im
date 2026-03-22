/**
 * Task runner — executes tasks via sdkChat with AbortController-based cancellation.
 *
 * Each task gets its own AbortController registered by taskId.
 * Cancellation aborts the SDK query. Completion/failure removes the registration.
 */
import { sdkChat } from "./sdk-chat.js";
import type { SdkChatOpts } from "./sdk-chat.js";
import { createLogger } from "@mecha/core";

const log = createLogger("mecha:task-runner");

/** Result reported back to the caller when a task completes or fails. */
export interface TaskRunResult {
  status: "completed" | "failed" | "cancelled";
  result?: string;
  sessionId?: string;
  durationMs?: number;
  costUsd?: number;
  error?: string;
}

/** Callback invoked when a task reaches a terminal state. */
export type TaskResultCallback = (result: TaskRunResult) => void;

/** Registry of in-flight task AbortControllers. */
const runningTasks = new Map<string, AbortController>();

/**
 * Start executing a task asynchronously.
 * The callback fires exactly once when the task completes, fails, or is cancelled.
 */
export function startTask(
  taskId: string,
  sdkChatOpts: SdkChatOpts,
  message: string,
  callback: TaskResultCallback,
): void {
  if (runningTasks.has(taskId)) {
    callback({ status: "failed", error: `Task ${taskId} is already running` });
    return;
  }

  const ac = new AbortController();
  runningTasks.set(taskId, ac);

  void (async () => {
    try {
      const chatResult = await sdkChat(sdkChatOpts, message, undefined, ac.signal);
      if (ac.signal.aborted) {
        callback({ status: "cancelled" });
        return;
      }
      callback({
        status: "completed",
        result: chatResult.response,
        sessionId: chatResult.sessionId,
        durationMs: chatResult.durationMs,
        costUsd: chatResult.costUsd,
      });
    } catch (err) {
      if (ac.signal.aborted) {
        callback({ status: "cancelled" });
      } else {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log.error("Task execution failed", { taskId, error: errorMsg });
        callback({ status: "failed", error: errorMsg });
      }
    } finally {
      runningTasks.delete(taskId);
    }
  })();
}

/** Cancel a running task. Returns true if cancellation was initiated. */
export function cancelTask(taskId: string): boolean {
  const ac = runningTasks.get(taskId);
  if (!ac) return false;
  ac.abort();
  return true;
}

/** Check if a task is currently executing. */
export function isTaskRunning(taskId: string): boolean {
  return runningTasks.has(taskId);
}

/** Get the number of currently running tasks. */
export function runningTaskCount(): number {
  return runningTasks.size;
}
