/**
 * Task storage — read/write/list/clean task JSON files.
 * Tasks are stored at ~/.mecha/tasks/<id>.json
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TaskSchema, TERMINAL_STATUSES } from "./task-types.js";
import type { Task, TaskStatus } from "./task-types.js";

function taskPath(dir: string, id: string): string {
  return join(dir, `${id}.json`);
}

/** Get the tasks directory path: ~/.mecha/tasks */
export function tasksDir(mechaDir: string): string {
  return join(mechaDir, "tasks");
}

/** Write a task to disk. Creates the directory if needed. */
export function writeTask(dir: string, task: Task): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(taskPath(dir, task.id), JSON.stringify(task, null, 2) + "\n", { mode: 0o600 });
}

/** Read a task by ID. Returns undefined if not found or corrupt. */
export function readTask(dir: string, id: string): Task | undefined {
  const p = taskPath(dir, id);
  /* v8 ignore start -- ENOENT expected when task doesn't exist */
  if (!existsSync(p)) return undefined;
  try {
    return TaskSchema.parse(JSON.parse(readFileSync(p, "utf-8")));
  } catch {
    return undefined;
  }
  /* v8 ignore stop */
}

/** List tasks with optional filters. Sorted by updatedAt descending. */
export function listTasks(
  dir: string,
  filter?: { status?: TaskStatus; target?: string },
): Task[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const tasks: Task[] = [];
  for (const file of files) {
    const task = readTask(dir, file.replace(".json", ""));
    if (!task) continue;
    if (filter?.status && task.status !== filter.status) continue;
    if (filter?.target && task.target !== filter.target) continue;
    tasks.push(task);
  }
  return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Delete a task file. Returns true if deleted, false if not found. */
export function deleteTask(dir: string, id: string): boolean {
  const p = taskPath(dir, id);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

/** Clean tasks in terminal state older than retentionDays. Returns count cleaned. */
export function cleanExpiredTasks(dir: string, retentionDays: number): number {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const tasks = listTasks(dir);
  let cleaned = 0;
  for (const task of tasks) {
    if (TERMINAL_STATUSES.includes(task.status) && new Date(task.updatedAt).getTime() < cutoff) {
      deleteTask(dir, task.id);
      cleaned++;
    }
  }
  return cleaned;
}

/**
 * Startup reconciliation: mark stale "working" tasks as failed.
 * Called on agent server startup to handle tasks that were running
 * when the previous agent process died.
 */
export function reconcileStaleTasks(dir: string): number {
  if (!existsSync(dir)) return 0;
  const tasks = listTasks(dir, { status: "working" });
  for (const task of tasks) {
    task.status = "failed";
    task.error = "Agent restarted — task execution was interrupted";
    task.updatedAt = new Date().toISOString();
    writeTask(dir, task);
  }
  return tasks.length;
}
