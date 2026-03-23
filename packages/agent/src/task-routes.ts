/**
 * Agent server task routes — proxy to bot runtime /api/tasks.
 *
 * Routes:
 * - POST  /tasks         — create task, proxy to runtime, return task ID
 * - GET   /tasks         — list tasks from storage
 * - GET   /tasks/:id     — get single task
 * - PATCH /tasks/:id     — update task with result (runtime callback)
 * - POST  /tasks/:id/cancel — proxy cancel to runtime, update storage
 */
import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  isValidName,
  readBotConfig,
  TaskCreateInputSchema,
  TaskStatusSchema,
  writeTask,
  readTask,
  listTasks,
  tasksDir,
  reconcileStaleTasks,
  cleanExpiredTasks,
} from "@mecha/core";
import type { AclEngine, Capability, Task, TaskStatus } from "@mecha/core";
import type { AuthContext } from "./auth.js";

export interface TaskRouteOpts {
  mechaDir: string;
  acl: AclEngine;
  authCtx: AuthContext;
}

let lastCleanup = 0;
const CLEANUP_INTERVAL_MS = 60_000;

/** Extract the bare bot name from a source identity (e.g. "bot@local" → "bot"). */
function bareName(source: string): string {
  const atIdx = source.indexOf("@");
  return atIdx >= 0 ? source.slice(0, atIdx) : source;
}

/** Check if caller is authorized for a specific task (source, target, or admin). */
function isTaskAuthorized(source: string, task: Task): boolean {
  if (source === "admin") return true;
  // Match against stored source (exact or bare) and target (exact or bare)
  const bare = bareName(source);
  return source === task.source || bare === bareName(task.source)
    || source === task.target || bare === task.target;
}

/** Extract caller identity from request headers. */
function getSource(req: { headers: Record<string, string | string[] | undefined> }): string {
  return (req.headers["x-mecha-source"] as string) ?? "admin";
}

/** Register task routes on the agent server. */
export function registerTaskRoutes(app: FastifyInstance, opts: TaskRouteOpts): void {
  const { mechaDir, acl } = opts;
  const dir = tasksDir(mechaDir);

  // Startup reconciliation — mark stale working tasks as failed
  const reconciled = reconcileStaleTasks(dir);
  if (reconciled > 0) {
    app.log.info(`Reconciled ${reconciled} stale working task(s)`);
  }

  // POST /tasks — create and start a task
  app.post<{ Body: { target: string; message: string } }>("/tasks", async (req, reply) => {
    const parsed = TaskCreateInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.issues });
    }

    const { target, message } = parsed.data;

    // Validate target bot name
    if (!isValidName(target)) {
      return reply.code(400).send({ error: "Invalid bot name" });
    }

    // ACL check
    const source = (req.headers["x-mecha-source"] as string) ?? "admin";
    const aclResult = acl.check(source, target, "query" as Capability);
    if (!aclResult.allowed) {
      return reply.code(403).send({ error: "Access denied", reason: aclResult.reason });
    }

    // Check bot exists and get runtime port/token
    const botDir = join(mechaDir, target);
    const config = readBotConfig(botDir);
    if (!config) {
      return reply.code(404).send({ error: `Bot '${target}' not found` });
    }

    // Create task
    const taskId = `task-${randomBytes(8).toString("hex")}`;
    const now = new Date().toISOString();
    const task: Task = {
      id: taskId,
      source,
      target,
      status: "pending",
      message,
      createdAt: now,
      updatedAt: now,
    };
    writeTask(dir, task);

    // Proxy to runtime — fire and forget
    /* v8 ignore start -- runtime proxy requires live bot process */
    void (async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${config.port}/api/tasks`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.token}`,
          },
          body: JSON.stringify({ taskId, message }),
          signal: AbortSignal.timeout(10_000),
        });
        // Re-read task from disk to avoid clobbering PATCH callback that may have landed first
        const current = readTask(dir, taskId);
        if (!current || current.status !== "pending") return; // already updated by callback
        if (res.ok) {
          current.status = "working";
          current.updatedAt = new Date().toISOString();
          writeTask(dir, current);
        } else {
          current.status = "failed";
          current.error = `Runtime rejected: HTTP ${res.status}`;
          current.updatedAt = new Date().toISOString();
          writeTask(dir, current);
        }
      } catch (err) {
        const current = readTask(dir, taskId);
        if (!current || current.status !== "pending") return;
        current.status = "failed";
        current.error = `Runtime unreachable: ${err instanceof Error ? err.message : String(err)}`;
        current.updatedAt = new Date().toISOString();
        writeTask(dir, current);
      }
    })();
    /* v8 ignore stop */

    return reply.code(201).send({ id: taskId, status: "pending" });
  });

  // GET /tasks — list tasks (filtered by caller ownership)
  app.get<{ Querystring: { target?: string; status?: string } }>("/tasks", async (req, reply) => {
    // Opportunistic cleanup — at most once per minute
    const now = Date.now();
    if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
      cleanExpiredTasks(dir, 7);
      lastCleanup = now;
    }

    const filter: { target?: string; status?: TaskStatus } = {};
    if (req.query.target) filter.target = req.query.target;
    if (req.query.status) {
      const statusParsed = TaskStatusSchema.safeParse(req.query.status);
      if (!statusParsed.success) {
        return reply.code(400).send({ error: `Invalid status. Valid: pending, working, completed, failed, cancelled` });
      }
      filter.status = statusParsed.data;
    }

    const source = getSource(req);
    let tasks = listTasks(dir, filter);
    // Non-admin callers only see their own tasks (source or target)
    if (source !== "admin") {
      tasks = tasks.filter((t) => t.source === source || t.target === source);
    }
    return reply.send(tasks);
  });

  // GET /tasks/:id — get single task (ownership check)
  app.get<{ Params: { id: string } }>("/tasks/:id", async (req, reply) => {
    const task = readTask(dir, req.params.id);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }
    const source = getSource(req);
    if (!isTaskAuthorized(source, task)) {
      return reply.code(403).send({ error: "Access denied" });
    }
    return reply.send(task);
  });

  // PATCH /tasks/:id — update task with result (runtime callback only)
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/tasks/:id", async (req, reply) => {
    const task = readTask(dir, req.params.id);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }
    // Only the task's target bot (runtime callback) or admin can update results
    const source = getSource(req);
    if (source !== "admin" && !source.startsWith(`${task.target}@`)) {
      return reply.code(403).send({ error: "Only the executing bot can update task results" });
    }
    const body = req.body ?? {};

    // Validate status if provided
    if (body.status !== undefined) {
      const statusParsed = TaskStatusSchema.safeParse(body.status);
      if (!statusParsed.success) {
        return reply.code(400).send({ error: "Invalid status" });
      }
      task.status = statusParsed.data;
    }
    if (typeof body.result === "string") task.result = body.result;
    if (typeof body.error === "string") task.error = body.error;
    if (typeof body.sessionId === "string") task.sessionId = body.sessionId;
    if (typeof body.durationMs === "number") task.durationMs = body.durationMs;
    if (typeof body.costUsd === "number") task.costUsd = body.costUsd;
    task.updatedAt = new Date().toISOString();
    writeTask(dir, task);
    return reply.send({ updated: true });
  });

  // POST /tasks/:id/cancel — cancel a task (ownership check, always proxy to runtime)
  app.post<{ Params: { id: string } }>("/tasks/:id/cancel", async (req, reply) => {
    const task = readTask(dir, req.params.id);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }

    // Only task source or admin can cancel
    const source = getSource(req);
    if (!isTaskAuthorized(source, task)) {
      return reply.code(403).send({ error: "Access denied" });
    }

    if (task.status !== "pending" && task.status !== "working") {
      return reply.code(409).send({ error: `Cannot cancel task in '${task.status}' status` });
    }

    // Always proxy cancel to runtime (covers both pending-dispatched and working states)
    /* v8 ignore start -- runtime proxy requires live bot process */
    const botConfig = readBotConfig(join(mechaDir, task.target));
    if (botConfig) {
      try {
        await fetch(`http://127.0.0.1:${botConfig.port}/api/tasks/${task.id}/cancel`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${botConfig.token}`,
          },
          body: "{}",
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        // Best effort — runtime may not know this task yet or may be gone
      }
    }
    /* v8 ignore stop */

    // Re-read from disk in case PATCH callback landed during the proxy call
    const current = readTask(dir, task.id) ?? task;
    current.status = "cancelled";
    current.updatedAt = new Date().toISOString();
    writeTask(dir, current);
    return reply.send({ cancelled: true });
  });
}
