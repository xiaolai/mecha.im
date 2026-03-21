import { describe, it, expect } from "vitest";
import { createExperiment, runExperiment, compareResults } from "../src/experiment.js";
import type { RunTrace } from "../src/types.js";

function makeTrace(overrides: Partial<RunTrace> = {}): RunTrace {
  return {
    traceId: "t-1",
    workflow: "test-wf",
    startedAt: "2026-03-21T10:00:00Z",
    completedAt: "2026-03-21T10:05:00Z",
    status: "done",
    totalCostUsd: 1.0,
    steps: [],
    ...overrides,
  };
}

describe("createExperiment", () => {
  it("creates an experiment definition", () => {
    const experiment = createExperiment({
      name: "prompt-test",
      variantA: { label: "A", config: { systemPrompt: "Be concise" } },
      variantB: { label: "B", config: { systemPrompt: "Be verbose" } },
      workflow: "pipeline",
      runs: 5,
    });

    expect(experiment.name).toBe("prompt-test");
    expect(experiment.variantA.label).toBe("A");
    expect(experiment.variantB.config).toEqual({ systemPrompt: "Be verbose" });
    expect(experiment.workflow).toBe("pipeline");
    expect(experiment.runs).toBe(5);
  });

  it("throws when name is empty", () => {
    expect(() =>
      createExperiment({
        name: "",
        variantA: { label: "A", config: {} },
        variantB: { label: "B", config: {} },
        workflow: "wf",
        runs: 1,
      }),
    ).toThrow("Experiment name is required");
  });

  it("throws when runs is less than 1", () => {
    expect(() =>
      createExperiment({
        name: "test",
        variantA: { label: "A", config: {} },
        variantB: { label: "B", config: {} },
        workflow: "wf",
        runs: 0,
      }),
    ).toThrow("Runs must be at least 1");
  });
});

describe("compareResults", () => {
  it("picks variant A when it has lower cost and higher quality", () => {
    const tracesA = [
      makeTrace({ traceId: "a1", totalCostUsd: 0.5, qualityScore: 4.5 }),
      makeTrace({ traceId: "a2", totalCostUsd: 0.6, qualityScore: 4.0 }),
    ];
    const tracesB = [
      makeTrace({ traceId: "b1", totalCostUsd: 2.0, qualityScore: 2.0 }),
      makeTrace({ traceId: "b2", totalCostUsd: 2.5, qualityScore: 2.5 }),
    ];

    const result = compareResults("test", "A", tracesA, "B", tracesB);
    expect(result.winner).toBe("A");
    expect(result.variantA.avgCostUsd).toBeCloseTo(0.55);
    expect(result.variantB.avgCostUsd).toBeCloseTo(2.25);
    expect(result.variantA.avgQualityScore).toBeCloseTo(4.25);
  });

  it("picks variant B when it is better", () => {
    const tracesA = [
      makeTrace({ traceId: "a1", totalCostUsd: 5.0, qualityScore: 1.0 }),
    ];
    const tracesB = [
      makeTrace({ traceId: "b1", totalCostUsd: 1.0, qualityScore: 5.0 }),
    ];

    const result = compareResults("test", "A", tracesA, "B", tracesB);
    expect(result.winner).toBe("B");
  });

  it("returns tie when metrics are identical", () => {
    const tracesA = [
      makeTrace({ traceId: "a1", totalCostUsd: 1.0, qualityScore: 4.0 }),
    ];
    const tracesB = [
      makeTrace({ traceId: "b1", totalCostUsd: 1.0, qualityScore: 4.0 }),
    ];

    const result = compareResults("test", "A", tracesA, "B", tracesB);
    expect(result.winner).toBe("tie");
  });

  it("computes confidence based on sample size", () => {
    // Low: < 6 total runs
    const low = compareResults(
      "test", "A",
      [makeTrace({ traceId: "a1" })],
      "B",
      [makeTrace({ traceId: "b1" })],
    );
    expect(low.confidence).toBe("low");

    // Medium: 6-19 total runs
    const medA = Array.from({ length: 5 }, (_, i) => makeTrace({ traceId: `a${i}` }));
    const medB = Array.from({ length: 5 }, (_, i) => makeTrace({ traceId: `b${i}` }));
    const medium = compareResults("test", "A", medA, "B", medB);
    expect(medium.confidence).toBe("medium");

    // High: >= 20 total runs
    const highA = Array.from({ length: 10 }, (_, i) => makeTrace({ traceId: `a${i}` }));
    const highB = Array.from({ length: 10 }, (_, i) => makeTrace({ traceId: `b${i}` }));
    const high = compareResults("test", "A", highA, "B", highB);
    expect(high.confidence).toBe("high");
  });

  it("handles empty traces for one variant", () => {
    const tracesA = [makeTrace({ traceId: "a1", totalCostUsd: 1.0, qualityScore: 4.0 })];
    const tracesB: RunTrace[] = [];

    const result = compareResults("test", "A", tracesA, "B", tracesB);
    expect(result.variantB.runs).toBe(0);
    expect(result.variantB.avgCostUsd).toBe(0);
    expect(result.variantB.successRate).toBe(0);
    expect(result.variantB.avgQualityScore).toBeUndefined();
  });

  it("handles traces without quality scores", () => {
    const tracesA = [makeTrace({ traceId: "a1", totalCostUsd: 1.0 })];
    const tracesB = [makeTrace({ traceId: "b1", totalCostUsd: 2.0 })];

    const result = compareResults("test", "A", tracesA, "B", tracesB);
    expect(result.variantA.avgQualityScore).toBeUndefined();
    expect(result.variantB.avgQualityScore).toBeUndefined();
    // A wins on cost, tie on quality and success rate
    expect(result.winner).toBe("A");
  });

  it("computes success rate from status field", () => {
    const tracesA = [
      makeTrace({ traceId: "a1", status: "done" }),
      makeTrace({ traceId: "a2", status: "failed" }),
    ];
    const tracesB = [
      makeTrace({ traceId: "b1", status: "done" }),
      makeTrace({ traceId: "b2", status: "done" }),
    ];

    const result = compareResults("test", "A", tracesA, "B", tracesB);
    expect(result.variantA.successRate).toBe(0.5);
    expect(result.variantB.successRate).toBe(1.0);
  });

  it("computes avg duration from timestamps", () => {
    const tracesA = [
      makeTrace({
        traceId: "a1",
        startedAt: "2026-03-21T10:00:00Z",
        completedAt: "2026-03-21T10:10:00Z", // 10 min = 600000ms
      }),
    ];
    const tracesB = [
      makeTrace({
        traceId: "b1",
        startedAt: "2026-03-21T10:00:00Z",
        completedAt: "2026-03-21T10:05:00Z", // 5 min = 300000ms
      }),
    ];

    const result = compareResults("test", "A", tracesA, "B", tracesB);
    expect(result.variantA.avgDurationMs).toBe(600000);
    expect(result.variantB.avgDurationMs).toBe(300000);
  });

  it("handles traces without completion time", () => {
    const traces = [makeTrace({ traceId: "a1", completedAt: undefined })];
    const result = compareResults("test", "A", traces, "B", traces);
    expect(result.variantA.avgDurationMs).toBe(0);
  });
});

describe("runExperiment", () => {
  it("runs executor for both variants and returns comparison", async () => {
    const experiment = createExperiment({
      name: "e2e-test",
      variantA: { label: "concise", config: { systemPrompt: "short" } },
      variantB: { label: "verbose", config: { systemPrompt: "long" } },
      workflow: "pipeline",
      runs: 2,
    });

    const executor = async (
      _config: Record<string, unknown>,
      _workflow: string,
      runs: number,
    ): Promise<RunTrace[]> => {
      return Array.from({ length: runs }, (_, i) =>
        makeTrace({
          traceId: `run-${i}`,
          totalCostUsd: _config.systemPrompt === "short" ? 0.5 : 2.0,
          qualityScore: _config.systemPrompt === "short" ? 4.0 : 3.0,
        }),
      );
    };

    const result = await runExperiment(experiment, executor);
    expect(result.name).toBe("e2e-test");
    expect(result.winner).toBe("A"); // cheaper + higher quality
    expect(result.variantA.label).toBe("concise");
    expect(result.variantB.label).toBe("verbose");
    expect(result.variantA.runs).toBe(2);
    expect(result.variantB.runs).toBe(2);
  });
});
