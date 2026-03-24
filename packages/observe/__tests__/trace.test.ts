import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTraceStore, buildTrace } from "../src/trace.js";
import type { RunTrace } from "../src/types.js";

describe("TraceStore", () => {
  let tracesDir: string;

  beforeEach(() => {
    tracesDir = mkdtempSync(join(tmpdir(), "mecha-traces-"));
  });

  function makeTrace(id: string, workflow = "test-wf"): RunTrace {
    return {
      traceId: id,
      workflow,
      startedAt: "2026-03-21T10:00:00Z",
      completedAt: "2026-03-21T10:05:00Z",
      status: "done",
      totalCostUsd: 1.50,
      steps: [
        { stepId: "s1", bot: "researcher", status: "completed", costUsd: 0.50, duration: "2m" },
        { stepId: "s2", bot: "writer", status: "completed", costUsd: 1.00, duration: "3m" },
      ],
    };
  }

  it("saves and loads a trace", () => {
    const store = createTraceStore(tracesDir);
    const trace = makeTrace("run-001");
    store.save(trace);

    const loaded = store.load("test-wf", "run-001");
    expect(loaded).not.toBeNull();
    expect(loaded!.traceId).toBe("run-001");
    expect(loaded!.steps).toHaveLength(2);
  });

  it("returns null for missing trace", () => {
    const store = createTraceStore(tracesDir);
    expect(store.load("test-wf", "nonexistent")).toBeNull();
  });

  it("lists traces for a workflow", () => {
    const store = createTraceStore(tracesDir);
    store.save(makeTrace("run-001"));
    store.save(makeTrace("run-002"));
    store.save(makeTrace("other-001", "other-wf"));

    const list = store.list("test-wf");
    expect(list).toHaveLength(2);
    // Most recent first (reverse alpha)
    expect(list[0]!.traceId).toBe("run-002");
  });

  it("respects limit parameter", () => {
    const store = createTraceStore(tracesDir);
    for (let i = 0; i < 5; i++) store.save(makeTrace(`run-${String(i).padStart(3, "0")}`));
    expect(store.list("test-wf", 2)).toHaveLength(2);
  });

  it("returns empty for unknown workflow", () => {
    const store = createTraceStore(tracesDir);
    expect(store.list("unknown")).toEqual([]);
  });

  it("lists workflow names", () => {
    const store = createTraceStore(tracesDir);
    store.save(makeTrace("r1", "wf-a"));
    store.save(makeTrace("r2", "wf-b"));
    expect(store.workflows().sort()).toEqual(["wf-a", "wf-b"]);
  });

  it("rejects workflow name containing '..'", () => {
    const store = createTraceStore(tracesDir);
    const trace = makeTrace("run-001", "foo..bar");
    expect(() => store.save(trace)).toThrow('Invalid workflow name: "foo..bar"');
  });

  it("rejects traceId containing '..'", () => {
    const store = createTraceStore(tracesDir);
    const trace = makeTrace("id..bad", "valid-wf");
    expect(() => store.save(trace)).toThrow('Invalid traceId name: "id..bad"');
  });

  it("rejects empty workflow name", () => {
    const store = createTraceStore(tracesDir);
    const trace = makeTrace("run-001", "");
    expect(() => store.save(trace)).toThrow('Invalid workflow name: ""');
  });

  it("rejects '.' as workflow name", () => {
    const store = createTraceStore(tracesDir);
    const trace = makeTrace("run-001", ".");
    expect(() => store.save(trace)).toThrow('Invalid workflow name: "."');
  });

  it("rejects '..' as workflow name", () => {
    const store = createTraceStore(tracesDir);
    const trace = makeTrace("run-001", "..");
    expect(() => store.save(trace)).toThrow('Invalid workflow name: ".."');
  });

  it("rejects workflow name with forward slash", () => {
    const store = createTraceStore(tracesDir);
    const trace = makeTrace("run-001", "a/b");
    expect(() => store.save(trace)).toThrow('Invalid workflow name: "a/b"');
  });

  it("rejects workflow name with backslash", () => {
    const store = createTraceStore(tracesDir);
    const trace = makeTrace("run-001", "a\\b");
    expect(() => store.save(trace)).toThrow('Invalid workflow name: "a\\b"');
  });

  it("rejects traceId with '..' in load", () => {
    const store = createTraceStore(tracesDir);
    expect(() => store.load("valid-wf", "foo..bar")).toThrow('Invalid traceId name: "foo..bar"');
  });

  it("returns empty workflows when tracesDir does not exist", () => {
    const dir = join(tracesDir, "will-be-removed");
    const store = createTraceStore(dir);
    // Remove the directory after creation to hit the !existsSync branch
    rmSync(dir, { recursive: true });
    expect(store.workflows()).toEqual([]);
  });
});

describe("buildTrace", () => {
  it("builds a trace from run state", () => {
    const trace = buildTrace({
      runId: "run-001",
      workflow: "pipeline",
      status: "done",
      startedAt: "2026-03-21T10:00:00Z",
      completedAt: "2026-03-21T10:05:00Z",
      totalCostUsd: 2.00,
      steps: {
        research: {
          status: "completed",
          startedAt: "2026-03-21T10:00:00Z",
          completedAt: "2026-03-21T10:02:00Z",
          costUsd: 0.50,
        },
        draft: {
          status: "completed",
          startedAt: "2026-03-21T10:02:00Z",
          completedAt: "2026-03-21T10:05:00Z",
          costUsd: 1.50,
        },
      },
      stepBots: { research: "researcher", draft: "writer" },
    });

    expect(trace.traceId).toBe("run-001");
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[0]!.bot).toBe("researcher");
    expect(trace.steps[0]!.duration).toBe("120.0s");
    expect(trace.steps[1]!.duration).toBe("180.0s");
  });

  it("handles missing timestamps", () => {
    const trace = buildTrace({
      runId: "run-002",
      workflow: "test",
      status: "failed",
      startedAt: "2026-03-21T10:00:00Z",
      totalCostUsd: 0,
      steps: {
        s1: { status: "failed", error: "boom" },
      },
      stepBots: { s1: "bot-a" },
    });

    expect(trace.steps[0]!.duration).toBeUndefined();
    expect(trace.steps[0]!.error).toBe("boom");
  });

  it("defaults bot to 'unknown' when stepBots has no mapping", () => {
    const trace = buildTrace({
      runId: "run-003",
      workflow: "test",
      status: "done",
      startedAt: "2026-03-21T10:00:00Z",
      totalCostUsd: 0,
      steps: {
        unmapped: { status: "completed" },
      },
      stepBots: {},
    });

    expect(trace.steps[0]!.bot).toBe("unknown");
    expect(trace.steps[0]!.costUsd).toBe(0);
  });

  it("handles step with only startedAt (no completedAt)", () => {
    const trace = buildTrace({
      runId: "run-004",
      workflow: "test",
      status: "running",
      startedAt: "2026-03-21T10:00:00Z",
      totalCostUsd: 0.5,
      steps: {
        s1: { status: "running", startedAt: "2026-03-21T10:00:00Z" },
      },
      stepBots: { s1: "bot-a" },
    });

    expect(trace.steps[0]!.duration).toBeUndefined();
    expect(trace.steps[0]!.startedAt).toBe("2026-03-21T10:00:00Z");
    expect(trace.steps[0]!.completedAt).toBeUndefined();
  });
});
