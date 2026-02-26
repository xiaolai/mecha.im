import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { emptySummary, accumulateEvent, aggregateEvents, queryCostToday, queryCostForCasa } from "../src/query.js";
import { appendEvent } from "../src/events.js";
import type { MeterEvent } from "../src/types.js";

function makeEvent(overrides: Partial<MeterEvent> = {}): MeterEvent {
  return {
    id: "01TEST",
    ts: new Date().toISOString(),
    casa: "researcher",
    authProfile: "default",
    workspace: "/home/user/project",
    tags: ["research"],
    model: "claude-sonnet-4-6",
    stream: true,
    status: 200,
    modelActual: "claude-sonnet-4-6",
    latencyMs: 500,
    ttftMs: 50,
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationTokens: 0,
    cacheReadTokens: 80,
    costUsd: 0.01,
    ...overrides,
  };
}

describe("query", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  describe("emptySummary", () => {
    it("returns all zeros", () => {
      const s = emptySummary();
      expect(s.requests).toBe(0);
      expect(s.costUsd).toBe(0);
      expect(s.avgLatencyMs).toBe(0);
    });
  });

  describe("accumulateEvent", () => {
    it("accumulates tokens and cost", () => {
      const s = emptySummary();
      accumulateEvent(s, makeEvent({ inputTokens: 100, outputTokens: 50, costUsd: 0.01 }));
      expect(s.requests).toBe(1);
      expect(s.inputTokens).toBe(100);
      expect(s.outputTokens).toBe(50);
      expect(s.costUsd).toBe(0.01);
    });

    it("counts errors for non-200 status", () => {
      const s = emptySummary();
      accumulateEvent(s, makeEvent({ status: 429, costUsd: 0 }));
      expect(s.errors).toBe(1);
    });

    it("computes running average latency", () => {
      const s = emptySummary();
      accumulateEvent(s, makeEvent({ latencyMs: 100 }));
      accumulateEvent(s, makeEvent({ latencyMs: 300 }));
      expect(s.avgLatencyMs).toBeCloseTo(200, 1);
    });
  });

  describe("aggregateEvents", () => {
    it("groups by CASA", () => {
      const events = [
        makeEvent({ casa: "researcher", costUsd: 0.10 }),
        makeEvent({ casa: "coder", costUsd: 0.05 }),
        makeEvent({ casa: "researcher", costUsd: 0.20 }),
      ];
      const result = aggregateEvents(events, "test period");
      expect(result.total.requests).toBe(3);
      expect(result.total.costUsd).toBeCloseTo(0.35, 5);
      expect(result.byCasa["researcher"]!.costUsd).toBeCloseTo(0.30, 5);
      expect(result.byCasa["coder"]!.costUsd).toBeCloseTo(0.05, 5);
    });

    it("handles empty events", () => {
      const result = aggregateEvents([], "empty");
      expect(result.total.requests).toBe(0);
      expect(Object.keys(result.byCasa)).toHaveLength(0);
    });
  });

  describe("queryCostToday", () => {
    it("returns today's events from disk", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-query-"));
      appendEvent(tempDir, makeEvent({ id: "A", costUsd: 0.05 }));
      appendEvent(tempDir, makeEvent({ id: "B", costUsd: 0.10 }));

      const result = queryCostToday(tempDir);
      expect(result.total.requests).toBe(2);
      expect(result.total.costUsd).toBeCloseTo(0.15, 5);
    });

    it("returns empty when no events", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-query-"));
      const result = queryCostToday(tempDir);
      expect(result.total.requests).toBe(0);
    });
  });

  describe("queryCostForCasa", () => {
    it("filters events by CASA name", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-query-"));
      appendEvent(tempDir, makeEvent({ id: "A", casa: "researcher", costUsd: 0.10 }));
      appendEvent(tempDir, makeEvent({ id: "B", casa: "coder", costUsd: 0.05 }));
      appendEvent(tempDir, makeEvent({ id: "C", casa: "researcher", costUsd: 0.20 }));

      const result = queryCostForCasa(tempDir, "researcher");
      expect(result.total.requests).toBe(2);
      expect(result.total.costUsd).toBeCloseTo(0.30, 5);
      expect(result.period).toContain("researcher");
    });

    it("returns empty for unknown CASA", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-query-"));
      appendEvent(tempDir, makeEvent({ id: "A", casa: "researcher" }));

      const result = queryCostForCasa(tempDir, "unknown");
      expect(result.total.requests).toBe(0);
    });
  });
});
