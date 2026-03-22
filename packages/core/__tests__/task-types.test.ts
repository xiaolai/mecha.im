import { describe, it, expect } from "vitest";
import { TaskStatusSchema, TaskSchema, TaskCreateInputSchema, TERMINAL_STATUSES } from "../src/task-types.js";

describe("TaskStatusSchema", () => {
  it("accepts valid statuses", () => {
    for (const s of ["pending", "working", "completed", "failed", "cancelled"]) {
      expect(TaskStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects invalid status", () => {
    expect(() => TaskStatusSchema.parse("running")).toThrow();
    expect(() => TaskStatusSchema.parse("")).toThrow();
  });
});

describe("TERMINAL_STATUSES", () => {
  it("contains completed, failed, cancelled", () => {
    expect(TERMINAL_STATUSES).toEqual(["completed", "failed", "cancelled"]);
  });
});

describe("TaskSchema", () => {
  const validTask = {
    id: "task-abc12345",
    source: "admin",
    target: "analyst",
    status: "pending",
    message: "Review this code",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("validates a minimal task", () => {
    const parsed = TaskSchema.parse(validTask);
    expect(parsed.id).toBe("task-abc12345");
    expect(parsed.status).toBe("pending");
  });

  it("accepts optional fields", () => {
    const task = {
      ...validTask,
      status: "completed",
      result: "LGTM",
      sessionId: "sess-001",
      durationMs: 1500,
      costUsd: 0.02,
    };
    const parsed = TaskSchema.parse(task);
    expect(parsed.result).toBe("LGTM");
    expect(parsed.costUsd).toBe(0.02);
  });

  it("rejects task without required fields", () => {
    expect(() => TaskSchema.parse({ id: "x" })).toThrow();
    expect(() => TaskSchema.parse({ ...validTask, message: "" })).toThrow();
    expect(() => TaskSchema.parse({ ...validTask, target: "" })).toThrow();
  });
});

describe("TaskCreateInputSchema", () => {
  it("validates create input", () => {
    const input = { target: "analyst", message: "Review code" };
    expect(TaskCreateInputSchema.parse(input)).toMatchObject({ target: "analyst" });
  });

  it("rejects empty message", () => {
    expect(() => TaskCreateInputSchema.parse({ target: "analyst", message: "" })).toThrow();
  });

  it("rejects empty target", () => {
    expect(() => TaskCreateInputSchema.parse({ target: "", message: "hello" })).toThrow();
  });
});
