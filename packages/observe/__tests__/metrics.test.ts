import { describe, it, expect } from "vitest";
import { computeMetrics } from "../src/metrics.js";
import type { RunTrace } from "../src/types.js";

function makeTrace(overrides?: Partial<RunTrace>): RunTrace {
  return {
    traceId: "run-001",
    workflow: "pipeline",
    startedAt: "2026-03-21T10:00:00Z",
    completedAt: "2026-03-21T10:05:00Z",
    status: "done",
    totalCostUsd: 2.00,
    steps: [
      { stepId: "s1", bot: "researcher", status: "completed", costUsd: 0.50, startedAt: "2026-03-21T10:00:00Z", completedAt: "2026-03-21T10:02:00Z" },
      { stepId: "s2", bot: "writer", status: "completed", costUsd: 1.50, startedAt: "2026-03-21T10:02:00Z", completedAt: "2026-03-21T10:05:00Z" },
    ],
    ...overrides,
  };
}

describe("computeMetrics", () => {
  describe("by workflow", () => {
    it("computes metrics for a workflow", () => {
      const traces = [
        makeTrace({ traceId: "r1", totalCostUsd: 2.00 }),
        makeTrace({ traceId: "r2", totalCostUsd: 3.00 }),
      ];
      const result = computeMetrics(traces, { by: "workflow", name: "pipeline" });
      expect(result).not.toBeNull();
      expect(result!.runCount).toBe(2);
      expect(result!.successRate).toBe(1.0);
      expect(result!.avgCostUsd).toBe(2.50);
    });

    it("returns null for unknown workflow", () => {
      const result = computeMetrics([makeTrace()], { by: "workflow", name: "unknown" });
      expect(result).toBeNull();
    });

    it("returns null for empty traces", () => {
      expect(computeMetrics([], { by: "workflow", name: "x" })).toBeNull();
    });

    it("calculates success rate correctly", () => {
      const traces = [
        makeTrace({ traceId: "r1", status: "done" }),
        makeTrace({ traceId: "r2", status: "failed" }),
        makeTrace({ traceId: "r3", status: "done" }),
      ];
      const result = computeMetrics(traces, { by: "workflow", name: "pipeline" });
      expect(result!.successRate).toBeCloseTo(0.667, 2);
    });

    it("returns undefined avgQualityScore when no traces have qualityScore", () => {
      const traces = [makeTrace({ traceId: "r1" })];
      const result = computeMetrics(traces, { by: "workflow", name: "pipeline" });
      expect(result).not.toBeNull();
      expect(result!.avgQualityScore).toBeUndefined();
    });

    it("computes avgQualityScore when traces have qualityScore", () => {
      const traces = [
        makeTrace({ traceId: "r1", qualityScore: 4 }),
        makeTrace({ traceId: "r2", qualityScore: 6 }),
      ];
      const result = computeMetrics(traces, { by: "workflow", name: "pipeline" });
      expect(result!.avgQualityScore).toBe(5);
    });

    it("computes avgDurationMs as 0 when traces lack completedAt", () => {
      const traces = [
        makeTrace({ traceId: "r1", completedAt: undefined }),
      ];
      const result = computeMetrics(traces, { by: "workflow", name: "pipeline" });
      expect(result!.avgDurationMs).toBe(0);
    });

    it("picks earliest startedAt across workflow traces", () => {
      const traces = [
        makeTrace({ traceId: "r1", startedAt: "2026-03-21T12:00:00Z" }),
        makeTrace({ traceId: "r2", startedAt: "2026-03-21T10:00:00Z" }),
        makeTrace({ traceId: "r3", startedAt: "2026-03-21T11:00:00Z" }),
      ];
      const result = computeMetrics(traces, { by: "workflow", name: "pipeline" });
      expect(result!.period.from).toBe("2026-03-21T10:00:00Z");
    });
  });

  describe("by bot", () => {
    it("computes metrics for a bot across traces", () => {
      const traces = [
        makeTrace({ traceId: "r1" }),
        makeTrace({ traceId: "r2" }),
      ];
      const result = computeMetrics(traces, { by: "bot", name: "researcher" });
      expect(result).not.toBeNull();
      expect(result!.runCount).toBe(2); // researcher appears in 2 traces
      expect(result!.successRate).toBe(1.0);
      expect(result!.avgCostUsd).toBe(0.50);
    });

    it("returns null for unknown bot", () => {
      const result = computeMetrics([makeTrace()], { by: "bot", name: "nobody" });
      expect(result).toBeNull();
    });

    it("calculates duration", () => {
      const result = computeMetrics([makeTrace()], { by: "bot", name: "researcher" });
      expect(result!.avgDurationMs).toBe(120000); // 2 minutes
    });

    it("tracks revision rate", () => {
      const trace = makeTrace();
      trace.steps[0]!.revisionCount = 1;
      const result = computeMetrics([trace], { by: "bot", name: "researcher" });
      expect(result!.revisionRate).toBe(1.0);
    });

    it("returns undefined avgQualityScore when bot steps lack qualityScore", () => {
      const result = computeMetrics([makeTrace()], { by: "bot", name: "researcher" });
      expect(result).not.toBeNull();
      expect(result!.avgQualityScore).toBeUndefined();
    });

    it("computes avgQualityScore for bot steps that have it", () => {
      const trace = makeTrace();
      trace.steps[0]!.qualityScore = 8;
      const result = computeMetrics([trace], { by: "bot", name: "researcher" });
      expect(result!.avgQualityScore).toBe(8);
    });

    it("computes avgDurationMs as 0 when bot steps lack timestamps", () => {
      const trace = makeTrace({
        steps: [
          { stepId: "s1", bot: "researcher", status: "completed", costUsd: 0.50 },
        ],
      });
      const result = computeMetrics([trace], { by: "bot", name: "researcher" });
      expect(result!.avgDurationMs).toBe(0);
    });

    it("uses current time as earliest when no bot steps have startedAt", () => {
      const trace = makeTrace({
        steps: [
          { stepId: "s1", bot: "researcher", status: "completed", costUsd: 0.50 },
        ],
      });
      const result = computeMetrics([trace], { by: "bot", name: "researcher" });
      expect(result).not.toBeNull();
      expect(result!.period.from).toBeDefined();
    });

    it("picks earliest startedAt across bot steps", () => {
      const traces = [
        makeTrace({
          traceId: "r1",
          steps: [
            { stepId: "s1", bot: "researcher", status: "completed", costUsd: 0.50, startedAt: "2026-03-21T12:00:00Z", completedAt: "2026-03-21T12:01:00Z" },
          ],
        }),
        makeTrace({
          traceId: "r2",
          steps: [
            { stepId: "s1", bot: "researcher", status: "completed", costUsd: 0.50, startedAt: "2026-03-21T10:00:00Z", completedAt: "2026-03-21T10:01:00Z" },
          ],
        }),
      ];
      const result = computeMetrics(traces, { by: "bot", name: "researcher" });
      expect(result!.period.from).toBe("2026-03-21T10:00:00Z");
    });

    it("revision rate is 0 when no steps have revisionCount", () => {
      const result = computeMetrics([makeTrace()], { by: "bot", name: "researcher" });
      expect(result!.revisionRate).toBe(0);
    });
  });
});
