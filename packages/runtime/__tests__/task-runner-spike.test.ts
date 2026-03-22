/**
 * Spike test: prove the task execution model works.
 *
 * Mocks sdkChat at the module level to avoid spawning real Claude processes.
 * Tests the real AbortController flow, the real task-runner registry,
 * and the real state machine transitions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskRunResult } from "../src/task-runner.js";

// Mock sdkChat before importing task-runner
vi.mock("../src/sdk-chat.js", () => ({
  sdkChat: vi.fn(),
}));

const { sdkChat } = await import("../src/sdk-chat.js");
const { startTask, cancelTask, isTaskRunning, runningTaskCount } = await import("../src/task-runner.js");

const mockSdkChat = vi.mocked(sdkChat);

function makeSdkChatOpts() {
  return { workspacePath: "/tmp/test" };
}

describe("task-runner spike", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes a task and reports completed result", async () => {
    mockSdkChat.mockResolvedValueOnce({
      response: "LGTM — code looks clean",
      sessionId: "sess-001",
      durationMs: 1500,
      costUsd: 0.02,
    });

    const result = await new Promise<TaskRunResult>((resolve) => {
      startTask("task-001", makeSdkChatOpts(), "Review this code", resolve);
    });

    expect(result.status).toBe("completed");
    expect(result.result).toBe("LGTM — code looks clean");
    expect(result.sessionId).toBe("sess-001");
    expect(result.durationMs).toBe(1500);
    expect(result.costUsd).toBe(0.02);
    expect(isTaskRunning("task-001")).toBe(false);
  });

  it("reports failed when sdkChat throws", async () => {
    mockSdkChat.mockRejectedValueOnce(new Error("SDK query failed"));

    const result = await new Promise<TaskRunResult>((resolve) => {
      startTask("task-002", makeSdkChatOpts(), "Bad task", resolve);
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBe("SDK query failed");
    expect(isTaskRunning("task-002")).toBe(false);
  });

  it("cancels a running task via AbortController", async () => {
    // sdkChat that blocks until abort
    mockSdkChat.mockImplementationOnce((_opts, _msg, _sid, signal) =>
      new Promise((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    );

    const resultPromise = new Promise<TaskRunResult>((resolve) => {
      startTask("task-003", makeSdkChatOpts(), "Long task", resolve);
    });

    // Task should be running
    expect(isTaskRunning("task-003")).toBe(true);

    // Cancel it
    const cancelled = cancelTask("task-003");
    expect(cancelled).toBe(true);

    const result = await resultPromise;
    expect(result.status).toBe("cancelled");
    expect(isTaskRunning("task-003")).toBe(false);
  });

  it("tracks two concurrent tasks independently", async () => {
    let resolveTask1!: (v: { response: string; sessionId: string; durationMs: number; costUsd: number }) => void;
    let resolveTask2!: (v: { response: string; sessionId: string; durationMs: number; costUsd: number }) => void;

    mockSdkChat
      .mockImplementationOnce(() => new Promise((r) => { resolveTask1 = r; }))
      .mockImplementationOnce(() => new Promise((r) => { resolveTask2 = r; }));

    const result1Promise = new Promise<TaskRunResult>((resolve) => {
      startTask("task-a", makeSdkChatOpts(), "Task A", resolve);
    });
    const result2Promise = new Promise<TaskRunResult>((resolve) => {
      startTask("task-b", makeSdkChatOpts(), "Task B", resolve);
    });

    expect(isTaskRunning("task-a")).toBe(true);
    expect(isTaskRunning("task-b")).toBe(true);
    expect(runningTaskCount()).toBe(2);

    // Complete task B first
    resolveTask2({ response: "B done", sessionId: "s2", durationMs: 100, costUsd: 0.01 });
    const r2 = await result2Promise;
    expect(r2.status).toBe("completed");
    expect(r2.result).toBe("B done");
    expect(isTaskRunning("task-b")).toBe(false);
    expect(isTaskRunning("task-a")).toBe(true);

    // Then complete task A
    resolveTask1({ response: "A done", sessionId: "s1", durationMs: 200, costUsd: 0.02 });
    const r1 = await result1Promise;
    expect(r1.status).toBe("completed");
    expect(r1.result).toBe("A done");
    expect(runningTaskCount()).toBe(0);
  });

  it("rejects duplicate task IDs", async () => {
    mockSdkChat.mockImplementationOnce(() => new Promise(() => {})); // never resolves

    startTask("task-dup", makeSdkChatOpts(), "First", () => {});

    const result = await new Promise<TaskRunResult>((resolve) => {
      startTask("task-dup", makeSdkChatOpts(), "Second", resolve);
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("already running");

    // Clean up
    cancelTask("task-dup");
  });

  it("cancelTask returns false for unknown task ID", () => {
    expect(cancelTask("nonexistent")).toBe(false);
  });
});
