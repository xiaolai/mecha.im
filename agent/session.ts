import { z } from "zod";
import { safeReadJson } from "../shared/safe-read.js";
import { atomicWriteJson } from "../shared/atomic-write.js";
import { log } from "../shared/logger.js";
import { PATHS } from "./paths.js";

const taskSourceSchema = z.enum(["interactive", "schedule", "webhook", "interbot"]);

const taskSchema = z.object({
  id: z.string(),
  created: z.string(),
  started_at: z.string().optional(),
  ended_at: z.string().nullable().optional(),
  source: taskSourceSchema.default("interactive"),
  status: z.enum(["active", "completed", "error"]),
  summary: z.string().optional(),
  session_id: z.string().optional(),
  cost_usd: z.number().default(0),
  error: z.string().optional(),
});

const indexSchema = z.object({
  active_task_id: z.string().nullable().default(null),
  tasks: z.array(taskSchema).default([]),
});

type Task = z.infer<typeof taskSchema>;
type SessionIndex = z.infer<typeof indexSchema>;
export type TaskSource = z.infer<typeof taskSourceSchema>;

const INDEX_PATH = PATHS.taskIndex;
const MAX_TASKS = 500;

export class SessionManager {
  private index: SessionIndex;

  constructor() {
    const result = safeReadJson(INDEX_PATH, "session index", indexSchema);
    if (result.ok) {
      this.index = result.data;
    } else {
      if (result.reason !== "missing") {
        log.warn(`SessionManager: ${result.reason} — ${result.detail}. Reinitializing.`);
      }
      this.index = { active_task_id: null, tasks: [] };
      this.save();
    }
  }

  getActiveTask(): Task | undefined {
    if (!this.index.active_task_id) return undefined;
    return this.index.tasks.find((t) => t.id === this.index.active_task_id);
  }

  ensureActiveTask(source: TaskSource = "interactive"): Task {
    let task = this.getActiveTask();
    if (!task) {
      const now = new Date().toISOString();
      task = {
        id: crypto.randomUUID(),
        created: now,
        started_at: now,
        ended_at: null,
        source,
        status: "active",
        cost_usd: 0,
      };
      this.index.tasks.push(task);
      this.index.active_task_id = task.id;
      // Prune old completed/error tasks to prevent unbounded growth (keep active task)
      if (this.index.tasks.length > MAX_TASKS) {
        const activeId = this.index.active_task_id;
        const kept = this.index.tasks.filter((t) => t.id === activeId || t.status === "active");
        const rest = this.index.tasks.filter((t) => t.id !== activeId && t.status !== "active");
        this.index.tasks = [...rest.slice(-MAX_TASKS + kept.length), ...kept];
      }
      this.save();
    }
    return task;
  }

  beginIsolatedTask(source: Exclude<TaskSource, "interactive">): Task {
    this.completeTask();
    return this.ensureActiveTask(source);
  }

  captureSessionId(sessionId: string): void {
    const task = this.getActiveTask();
    if (task) {
      task.session_id = sessionId;
      this.save();
    }
  }

  addCost(costUsd: number): void {
    if (!Number.isFinite(costUsd) || costUsd < 0) return;
    const task = this.getActiveTask();
    if (task) {
      task.cost_usd += costUsd;
      this.save();
    }
  }

  completeTask(summary?: string): Task | undefined {
    const task = this.getActiveTask();
    if (task) {
      task.status = "completed";
      if (summary) task.summary = summary;
      task.ended_at = new Date().toISOString();
      this.index.active_task_id = null;
      this.save();
    }
    return task;
  }

  markError(error?: string): Task | undefined {
    const task = this.getActiveTask();
    if (task) {
      task.status = "error";
      if (error) {
        task.summary = error;
        task.error = error;
      }
      task.ended_at = new Date().toISOString();
      this.index.active_task_id = null;
      this.save();
    }
    return task;
  }

  newSession(summary?: string): { newTask: Task; previousTask?: Task } {
    const previousTask = this.completeTask(summary);
    const newTask = this.ensureActiveTask("interactive");
    return { newTask, previousTask };
  }

  listTasks(): Task[] {
    return [...this.index.tasks].reverse();
  }

  getTask(id: string): Task | undefined {
    return this.index.tasks.find((t) => t.id === id);
  }

  getResumeSessionId(): string | undefined {
    return this.getActiveTask()?.session_id;
  }

  private save(): void {
    atomicWriteJson(INDEX_PATH, this.index);
  }
}
