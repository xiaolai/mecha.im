import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createScoreStore } from "../src/scoring.js";

describe("ScoreStore", () => {
  let scoresDir: string;

  beforeEach(() => {
    scoresDir = mkdtempSync(join(tmpdir(), "mecha-scores-"));
  });

  it("records and retrieves scores for a run", () => {
    const store = createScoreStore(scoresDir);
    store.record({ runId: "run-1", score: 4, source: "human", scoredAt: "2026-03-21T10:00:00Z" });
    store.record({ runId: "run-1", stepId: "draft", bot: "writer", score: 3, source: "automated", scoredAt: "2026-03-21T10:01:00Z" });

    const scores = store.forRun("run-1");
    expect(scores).toHaveLength(2);
    expect(scores[0]!.score).toBe(4);
  });

  it("filters scores by bot", () => {
    const store = createScoreStore(scoresDir);
    store.record({ runId: "r1", bot: "writer", score: 4, source: "human", scoredAt: "2026-03-21T10:00:00Z" });
    store.record({ runId: "r2", bot: "writer", score: 5, source: "human", scoredAt: "2026-03-21T10:01:00Z" });
    store.record({ runId: "r3", bot: "editor", score: 3, source: "human", scoredAt: "2026-03-21T10:02:00Z" });

    expect(store.forBot("writer")).toHaveLength(2);
    expect(store.forBot("editor")).toHaveLength(1);
    expect(store.forBot("nobody")).toHaveLength(0);
  });

  it("computes average score for a bot", () => {
    const store = createScoreStore(scoresDir);
    store.record({ runId: "r1", bot: "writer", score: 3, source: "human", scoredAt: "2026-03-21T10:00:00Z" });
    store.record({ runId: "r2", bot: "writer", score: 5, source: "human", scoredAt: "2026-03-21T10:01:00Z" });

    expect(store.avgForBot("writer")).toBe(4);
  });

  it("returns undefined avg for unknown bot", () => {
    const store = createScoreStore(scoresDir);
    expect(store.avgForBot("nobody")).toBeUndefined();
  });

  it("returns all scores", () => {
    const store = createScoreStore(scoresDir);
    store.record({ runId: "r1", score: 4, source: "human", scoredAt: "2026-03-21T10:00:00Z" });
    store.record({ runId: "r2", score: 3, source: "implicit", scoredAt: "2026-03-21T10:01:00Z" });
    expect(store.all()).toHaveLength(2);
  });

  it("persists across re-creation", () => {
    const s1 = createScoreStore(scoresDir);
    s1.record({ runId: "r1", score: 5, source: "human", scoredAt: "2026-03-21T10:00:00Z" });

    const s2 = createScoreStore(scoresDir);
    expect(s2.all()).toHaveLength(1);
  });

  it("avgForWorkflow returns average of matching workflow scores", () => {
    const store = createScoreStore(scoresDir);
    // Run-level scores with workflow field
    store.record({ runId: "r1", workflow: "pipeline", score: 4, source: "human", scoredAt: "2026-03-21T10:00:00Z" });
    store.record({ runId: "r2", workflow: "pipeline", score: 6, source: "automated", scoredAt: "2026-03-21T10:01:00Z" });
    // Different workflow — should be excluded
    store.record({ runId: "r3", workflow: "deploy", score: 1, source: "human", scoredAt: "2026-03-21T10:02:00Z" });
    // Step-level score (has stepId) — should be excluded
    store.record({ runId: "r4", workflow: "pipeline", stepId: "draft", bot: "writer", score: 1, source: "implicit", scoredAt: "2026-03-21T10:03:00Z" });

    expect(store.avgForWorkflow("pipeline")).toBe(5);
  });

  it("avgForWorkflow excludes scores without workflow field", () => {
    const store = createScoreStore(scoresDir);
    // Legacy score without workflow field
    store.record({ runId: "r1", score: 4, source: "human", scoredAt: "2026-03-21T10:00:00Z" });
    // Score with workflow field
    store.record({ runId: "r2", workflow: "pipeline", score: 3, source: "human", scoredAt: "2026-03-21T10:01:00Z" });

    expect(store.avgForWorkflow("pipeline")).toBe(3);
  });

  it("avgForWorkflow returns undefined when no run-level scores exist", () => {
    const store = createScoreStore(scoresDir);
    // Only step-level scores
    store.record({ runId: "r1", workflow: "pipeline", stepId: "s1", bot: "writer", score: 3, source: "human", scoredAt: "2026-03-21T10:00:00Z" });

    expect(store.avgForWorkflow("pipeline")).toBeUndefined();
  });

  it("avgForWorkflow returns undefined on empty store", () => {
    const store = createScoreStore(scoresDir);
    expect(store.avgForWorkflow("any")).toBeUndefined();
  });

  it("avgForWorkflow returns undefined for unknown workflow", () => {
    const store = createScoreStore(scoresDir);
    store.record({ runId: "r1", workflow: "pipeline", score: 5, source: "human", scoredAt: "2026-03-21T10:00:00Z" });
    expect(store.avgForWorkflow("unknown")).toBeUndefined();
  });

  it("returns empty when scores file exists but is empty", () => {
    const store = createScoreStore(scoresDir);
    writeFileSync(join(scoresDir, "scores.jsonl"), "");
    expect(store.all()).toEqual([]);
  });
});
