import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createScoreStore } from "../src/scoring.js";
import { analyzeBotPerformance, suggestPromptChange } from "../src/tuning.js";

describe("analyzeBotPerformance", () => {
  let scoresDir: string;

  beforeEach(() => {
    scoresDir = mkdtempSync(join(tmpdir(), "mecha-tuning-"));
  });

  it("returns null when bot has no scores", () => {
    const store = createScoreStore(scoresDir);
    const result = analyzeBotPerformance(store, "unknown-bot");
    expect(result).toBeNull();
  });

  it("detects declining quality", () => {
    const store = createScoreStore(scoresDir);
    // Older scores: high quality
    store.record({ runId: "r1", bot: "writer", score: 5, source: "human", scoredAt: "2026-03-01T10:00:00Z" });
    store.record({ runId: "r2", bot: "writer", score: 4.5, source: "human", scoredAt: "2026-03-02T10:00:00Z" });
    store.record({ runId: "r3", bot: "writer", score: 4, source: "human", scoredAt: "2026-03-03T10:00:00Z" });
    // Recent scores: low quality
    store.record({ runId: "r4", bot: "writer", score: 2.5, source: "human", scoredAt: "2026-03-10T10:00:00Z" });
    store.record({ runId: "r5", bot: "writer", score: 2, source: "human", scoredAt: "2026-03-11T10:00:00Z" });
    store.record({ runId: "r6", bot: "writer", score: 2, source: "human", scoredAt: "2026-03-12T10:00:00Z" });

    const result = analyzeBotPerformance(store, "writer");
    expect(result).not.toBeNull();
    expect(result!.trend).toBe("declining");
    expect(result!.bot).toBe("writer");
    expect(result!.totalScores).toBe(6);
    expect(result!.recommendation).toContain("dropped");
    expect(result!.recommendation).toContain("writer");
  });

  it("detects improving quality", () => {
    const store = createScoreStore(scoresDir);
    // Older scores: low quality
    store.record({ runId: "r1", bot: "coder", score: 2, source: "human", scoredAt: "2026-03-01T10:00:00Z" });
    store.record({ runId: "r2", bot: "coder", score: 2.5, source: "human", scoredAt: "2026-03-02T10:00:00Z" });
    // Recent scores: high quality
    store.record({ runId: "r3", bot: "coder", score: 4, source: "human", scoredAt: "2026-03-10T10:00:00Z" });
    store.record({ runId: "r4", bot: "coder", score: 4.5, source: "human", scoredAt: "2026-03-11T10:00:00Z" });

    const result = analyzeBotPerformance(store, "coder");
    expect(result).not.toBeNull();
    expect(result!.trend).toBe("improving");
    expect(result!.recommendation).toContain("improved");
    expect(result!.recommendation).toContain("working well");
  });

  it("detects stable quality", () => {
    const store = createScoreStore(scoresDir);
    store.record({ runId: "r1", bot: "editor", score: 3.5, source: "human", scoredAt: "2026-03-01T10:00:00Z" });
    store.record({ runId: "r2", bot: "editor", score: 3.6, source: "human", scoredAt: "2026-03-02T10:00:00Z" });
    store.record({ runId: "r3", bot: "editor", score: 3.4, source: "human", scoredAt: "2026-03-10T10:00:00Z" });
    store.record({ runId: "r4", bot: "editor", score: 3.5, source: "human", scoredAt: "2026-03-11T10:00:00Z" });

    const result = analyzeBotPerformance(store, "editor");
    expect(result).not.toBeNull();
    expect(result!.trend).toBe("stable");
    expect(result!.recommendation).toContain("stable");
    expect(result!.recommendation).toContain("No immediate changes needed");
  });

  it("reports stable with low-quality warning when average is below 3", () => {
    const store = createScoreStore(scoresDir);
    store.record({ runId: "r1", bot: "bad-bot", score: 2, source: "human", scoredAt: "2026-03-01T10:00:00Z" });
    store.record({ runId: "r2", bot: "bad-bot", score: 2.2, source: "human", scoredAt: "2026-03-02T10:00:00Z" });
    store.record({ runId: "r3", bot: "bad-bot", score: 2.1, source: "human", scoredAt: "2026-03-10T10:00:00Z" });
    store.record({ runId: "r4", bot: "bad-bot", score: 2.3, source: "human", scoredAt: "2026-03-11T10:00:00Z" });

    const result = analyzeBotPerformance(store, "bad-bot");
    expect(result).not.toBeNull();
    expect(result!.trend).toBe("stable");
    expect(result!.recommendation).toContain("below 3.0");
    expect(result!.recommendation).toContain("significant prompt changes");
  });

  it("handles a single score as stable", () => {
    const store = createScoreStore(scoresDir);
    store.record({ runId: "r1", bot: "solo", score: 4, source: "human", scoredAt: "2026-03-01T10:00:00Z" });

    const result = analyzeBotPerformance(store, "solo");
    expect(result).not.toBeNull();
    expect(result!.trend).toBe("stable");
    expect(result!.totalScores).toBe(1);
    expect(result!.recommendation).toContain("Only 1 score");
    expect(result!.recommendation).toContain("Collect more data");
  });
});

describe("suggestPromptChange", () => {
  it("suggests reviewing prompt for declining trend", () => {
    const msg = suggestPromptChange({
      bot: "writer",
      trend: "declining",
      avgScore: 3.0,
      recentAvg: 2.5,
      olderAvg: 4.0,
      totalScores: 10,
    });
    expect(msg).toContain("dropped from 4.0 to 2.5");
    expect(msg).toContain("10 sessions");
    expect(msg).toContain("reviewing system prompt");
    expect(msg).toContain("writer");
  });

  it("confirms approach for improving trend", () => {
    const msg = suggestPromptChange({
      bot: "coder",
      trend: "improving",
      avgScore: 4.0,
      recentAvg: 4.5,
      olderAvg: 3.0,
      totalScores: 8,
    });
    expect(msg).toContain("improved from 3.0 to 4.5");
    expect(msg).toContain("working well");
  });

  it("suggests no changes for stable high quality", () => {
    const msg = suggestPromptChange({
      bot: "editor",
      trend: "stable",
      avgScore: 4.0,
      recentAvg: 4.0,
      olderAvg: 4.0,
      totalScores: 6,
    });
    expect(msg).toContain("stable at 4.0");
    expect(msg).toContain("No immediate changes needed");
  });

  it("warns about low average for stable low quality", () => {
    const msg = suggestPromptChange({
      bot: "bad-bot",
      trend: "stable",
      avgScore: 2.0,
      recentAvg: 2.0,
      olderAvg: 2.0,
      totalScores: 10,
    });
    expect(msg).toContain("below 3.0");
    expect(msg).toContain("significant prompt changes");
  });

  it("suggests collecting more data for single score", () => {
    const msg = suggestPromptChange({
      bot: "new-bot",
      trend: "stable",
      avgScore: 3.5,
      recentAvg: 3.5,
      olderAvg: 3.5,
      totalScores: 1,
    });
    expect(msg).toContain("Only 1 score");
    expect(msg).toContain("Collect more data");
  });
});
