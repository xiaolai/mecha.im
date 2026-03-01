import { describe, it, expect } from "vitest";
import { createHotCounters, ingestEvent, resetToday, resetMonth, toSnapshot, fromSnapshot } from "../src/hot-counters.js";
import type { MeterEvent } from "../src/types.js";

function makeEvent(overrides: Partial<MeterEvent> = {}): MeterEvent {
  return {
    id: "01TEST",
    ts: "2026-02-26T14:30:00.000Z",
    casa: "researcher",
    authProfile: "personal",
    workspace: "/ws",
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
    cacheReadTokens: 0,
    costUsd: 0.01,
    ...overrides,
  };
}

describe("hot-counters", () => {
  describe("createHotCounters", () => {
    it("creates empty counters for date", () => {
      const c = createHotCounters("2026-02-26");
      expect(c.date).toBe("2026-02-26");
      expect(c.global.today.requests).toBe(0);
      expect(c.global.thisMonth.requests).toBe(0);
    });
  });

  describe("ingestEvent", () => {
    it("accumulates into global and per-CASA", () => {
      const c = createHotCounters("2026-02-26");
      ingestEvent(c, makeEvent({ costUsd: 0.10 }));
      expect(c.global.today.requests).toBe(1);
      expect(c.global.today.costUsd).toBe(0.10);
      expect(c.global.thisMonth.requests).toBe(1);
      expect(c.byCasa["researcher"]!.today.costUsd).toBe(0.10);
    });

    it("accumulates into per-auth and per-tag", () => {
      const c = createHotCounters("2026-02-26");
      ingestEvent(c, makeEvent({ tags: ["research", "ml"] }));
      expect(c.byAuth["personal"]!.today.requests).toBe(1);
      expect(c.byTag["research"]!.today.requests).toBe(1);
      expect(c.byTag["ml"]!.today.requests).toBe(1);
    });

    it("accumulates multiple events", () => {
      const c = createHotCounters("2026-02-26");
      ingestEvent(c, makeEvent({ casa: "a", costUsd: 0.05 }));
      ingestEvent(c, makeEvent({ casa: "b", costUsd: 0.10 }));
      ingestEvent(c, makeEvent({ casa: "a", costUsd: 0.03 }));
      expect(c.global.today.requests).toBe(3);
      expect(c.global.today.costUsd).toBeCloseTo(0.18, 5);
      expect(c.byCasa["a"]!.today.requests).toBe(2);
      expect(c.byCasa["b"]!.today.requests).toBe(1);
    });
  });

  describe("ingestEvent — dedup tags", () => {
    it("deduplicates tags via Set", () => {
      const c = createHotCounters("2026-02-26");
      ingestEvent(c, makeEvent({ tags: ["dup", "dup", "dup"] }));
      expect(c.byTag["dup"]!.today.requests).toBe(1);
    });
  });

  describe("resetToday", () => {
    it("resets today counters but keeps thisMonth", () => {
      const c = createHotCounters("2026-02-26");
      ingestEvent(c, makeEvent({ costUsd: 0.10 }));
      resetToday(c, "2026-02-27");
      expect(c.date).toBe("2026-02-27");
      expect(c.global.today.requests).toBe(0);
      expect(c.global.thisMonth.requests).toBe(1);
      expect(c.global.thisMonth.costUsd).toBe(0.10);
      expect(c.byCasa["researcher"]!.today.requests).toBe(0);
      expect(c.byCasa["researcher"]!.thisMonth.requests).toBe(1);
    });

    it("prunes buckets with zero monthly activity", () => {
      const c = createHotCounters("2026-02-26");
      // Manually create a CASA bucket with zero monthly activity
      c.byCasa["stale"] = { today: { ...c.global.today }, thisMonth: { ...c.global.thisMonth } };
      c.byCasa["stale"]!.thisMonth.requests = 0;

      resetToday(c, "2026-02-27");
      expect(c.byCasa["stale"]).toBeUndefined();
    });
  });

  describe("resetMonth", () => {
    it("zeroes both today and thisMonth counters", () => {
      const c = createHotCounters("2026-02-26");
      ingestEvent(c, makeEvent({ costUsd: 0.10 }));
      expect(c.global.thisMonth.requests).toBe(1);
      expect(c.global.thisMonth.costUsd).toBe(0.10);

      resetMonth(c, "2026-03-01");
      expect(c.date).toBe("2026-03-01");
      expect(c.global.today.requests).toBe(0);
      expect(c.global.today.costUsd).toBe(0);
      expect(c.global.thisMonth.requests).toBe(0);
      expect(c.global.thisMonth.costUsd).toBe(0);
    });

    it("clears all per-CASA, per-auth, and per-tag buckets", () => {
      const c = createHotCounters("2026-02-26");
      ingestEvent(c, makeEvent({ casa: "a", authProfile: "p1", tags: ["t1"] }));
      ingestEvent(c, makeEvent({ casa: "b", authProfile: "p2", tags: ["t2"] }));
      expect(Object.keys(c.byCasa)).toHaveLength(2);
      expect(Object.keys(c.byAuth)).toHaveLength(2);
      expect(Object.keys(c.byTag)).toHaveLength(2);

      resetMonth(c, "2026-03-01");
      expect(Object.keys(c.byCasa)).toHaveLength(0);
      expect(Object.keys(c.byAuth)).toHaveLength(0);
      expect(Object.keys(c.byTag)).toHaveLength(0);
    });
  });

  describe("toSnapshot / fromSnapshot", () => {
    it("round-trips through snapshot", () => {
      const c = createHotCounters("2026-02-26");
      ingestEvent(c, makeEvent({ costUsd: 0.10 }));
      const snapshot = toSnapshot(c);
      expect(snapshot.date).toBe("2026-02-26");
      expect(snapshot.global.today.costUsd).toBe(0.10);

      const restored = fromSnapshot(snapshot);
      expect(restored.date).toBe("2026-02-26");
      expect(restored.global.today.costUsd).toBe(0.10);
      expect(restored.byCasa["researcher"]!.today.costUsd).toBe(0.10);
    });
  });
});
