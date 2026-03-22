import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writeTask, readTask, listTasks, deleteTask, cleanExpiredTasks,
  reconcileStaleTasks, tasksDir,
} from "../src/task-storage.js";
import type { Task } from "../src/task-types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-00000001",
    source: "admin",
    target: "analyst",
    status: "pending",
    message: "Review this code",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("tasksDir", () => {
  it("returns mechaDir/tasks", () => {
    expect(tasksDir("/home/user/.mecha")).toBe("/home/user/.mecha/tasks");
  });
});

describe("task-storage", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "task-storage-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes and reads a task round-trip", () => {
    const task = makeTask();
    writeTask(dir, task);
    const loaded = readTask(dir, task.id);
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe("task-00000001");
    expect(loaded!.status).toBe("pending");
    expect(loaded!.message).toBe("Review this code");
  });

  it("returns undefined for non-existent task", () => {
    expect(readTask(dir, "nonexistent")).toBeUndefined();
  });

  it("lists tasks sorted by updatedAt descending", () => {
    const old = new Date("2026-01-01").toISOString();
    const mid = new Date("2026-02-01").toISOString();
    const recent = new Date("2026-03-01").toISOString();

    writeTask(dir, makeTask({ id: "t1", updatedAt: old }));
    writeTask(dir, makeTask({ id: "t3", updatedAt: recent }));
    writeTask(dir, makeTask({ id: "t2", updatedAt: mid }));

    const tasks = listTasks(dir);
    expect(tasks.map((t) => t.id)).toEqual(["t3", "t2", "t1"]);
  });

  it("filters tasks by status", () => {
    writeTask(dir, makeTask({ id: "t1", status: "pending" }));
    writeTask(dir, makeTask({ id: "t2", status: "working" }));
    writeTask(dir, makeTask({ id: "t3", status: "completed" }));

    expect(listTasks(dir, { status: "pending" })).toHaveLength(1);
    expect(listTasks(dir, { status: "working" })).toHaveLength(1);
    expect(listTasks(dir)).toHaveLength(3);
  });

  it("filters tasks by target", () => {
    writeTask(dir, makeTask({ id: "t1", target: "analyst" }));
    writeTask(dir, makeTask({ id: "t2", target: "coder" }));

    expect(listTasks(dir, { target: "analyst" })).toHaveLength(1);
    expect(listTasks(dir, { target: "coder" })).toHaveLength(1);
    expect(listTasks(dir, { target: "nobody" })).toHaveLength(0);
  });

  it("returns empty array for non-existent directory", () => {
    expect(listTasks("/tmp/nonexistent-dir-abc123")).toEqual([]);
  });

  it("deletes a task", () => {
    writeTask(dir, makeTask());
    expect(deleteTask(dir, "task-00000001")).toBe(true);
    expect(readTask(dir, "task-00000001")).toBeUndefined();
    expect(deleteTask(dir, "task-00000001")).toBe(false);
  });

  it("cleans expired terminal tasks", () => {
    const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const recent = new Date().toISOString();

    writeTask(dir, makeTask({ id: "old-done", status: "completed", updatedAt: old }));
    writeTask(dir, makeTask({ id: "old-failed", status: "failed", updatedAt: old }));
    writeTask(dir, makeTask({ id: "old-working", status: "working", updatedAt: old }));
    writeTask(dir, makeTask({ id: "new-done", status: "completed", updatedAt: recent }));

    const cleaned = cleanExpiredTasks(dir, 7);
    expect(cleaned).toBe(2); // old-done + old-failed (not old-working — still "working")
    expect(readTask(dir, "old-done")).toBeUndefined();
    expect(readTask(dir, "old-failed")).toBeUndefined();
    expect(readTask(dir, "old-working")).toBeDefined(); // non-terminal, kept
    expect(readTask(dir, "new-done")).toBeDefined(); // recent, kept
  });

  it("reconciles stale working and pending tasks on startup", () => {
    writeTask(dir, makeTask({ id: "t1", status: "working" }));
    writeTask(dir, makeTask({ id: "t2", status: "working" }));
    writeTask(dir, makeTask({ id: "t3", status: "pending" }));
    writeTask(dir, makeTask({ id: "t4", status: "completed" }));

    const reconciled = reconcileStaleTasks(dir);
    expect(reconciled).toBe(3);

    const t1 = readTask(dir, "t1")!;
    expect(t1.status).toBe("failed");
    expect(t1.error).toContain("Agent restarted");

    const t3 = readTask(dir, "t3")!;
    expect(t3.status).toBe("failed");
    expect(t3.error).toContain("never dispatched");

    const t4 = readTask(dir, "t4")!;
    expect(t4.status).toBe("completed"); // unchanged
  });

  it("reconcileStaleTasks returns 0 for non-existent directory", () => {
    expect(reconcileStaleTasks("/tmp/nonexistent-dir-abc123")).toBe(0);
  });
});
