import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readHourlyRollup, readDailyRollup, readCasaRollup,
  writeHourlyRollup, writeDailyRollup, writeCasaRollup,
  updateHourlyRollup, updateDailyRollup, updateCasaRollup,
  flushRollups,
  hourlyRollupPath, dailyRollupPath, casaRollupPath,
} from "../src/rollups.js";
import { emptySummary } from "../src/query.js";
import type { MeterEvent, HourlyRollup, DailyRollup, CasaRollup } from "../src/types.js";

function makeEvent(overrides: Partial<MeterEvent> = {}): MeterEvent {
  return {
    id: "01TEST", ts: "2026-02-26T14:30:00.000Z",
    casa: "researcher", authProfile: "personal", workspace: "/ws",
    tags: ["research"], model: "claude-sonnet-4-6", stream: true, status: 200,
    modelActual: "claude-sonnet-4-6", latencyMs: 500, ttftMs: 50,
    inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0,
    cacheReadTokens: 0, costUsd: 0.01, ...overrides,
  };
}

describe("rollups", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  describe("hourly rollup", () => {
    it("reads empty for non-existent", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-rollup-"));
      const r = readHourlyRollup(tempDir, "2026-02-26");
      expect(r.date).toBe("2026-02-26");
      expect(r.hours).toEqual([]);
    });

    it("updates incrementally", () => {
      const r: HourlyRollup = { date: "2026-02-26", hours: [] };
      updateHourlyRollup(r, makeEvent({ ts: "2026-02-26T14:00:00Z", costUsd: 0.05 }));
      updateHourlyRollup(r, makeEvent({ ts: "2026-02-26T14:30:00Z", costUsd: 0.10 }));
      updateHourlyRollup(r, makeEvent({ ts: "2026-02-26T09:00:00Z", costUsd: 0.02, casa: "coder" }));

      expect(r.hours).toHaveLength(2);
      const h14 = r.hours.find(h => h.hour === 14)!;
      expect(h14.total.requests).toBe(2);
      expect(h14.total.costUsd).toBeCloseTo(0.15, 5);
      expect(h14.byCasa["researcher"]!.requests).toBe(2);

      const h9 = r.hours.find(h => h.hour === 9)!;
      expect(h9.total.requests).toBe(1);
      expect(h9.byCasa["coder"]!.costUsd).toBeCloseTo(0.02, 5);
    });

    it("falls back to model when modelActual is empty", () => {
      const r: HourlyRollup = { date: "2026-02-26", hours: [] };
      updateHourlyRollup(r, makeEvent({ modelActual: "", model: "claude-opus-4-6" }));
      const h = r.hours[0]!;
      expect(h.byModel["claude-opus-4-6"]!.requests).toBe(1);
    });

    it("round-trips through write/read", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-rollup-"));
      const r: HourlyRollup = { date: "2026-02-26", hours: [] };
      updateHourlyRollup(r, makeEvent());
      writeHourlyRollup(tempDir, r);

      const read = readHourlyRollup(tempDir, "2026-02-26");
      expect(read.hours).toHaveLength(1);
      expect(read.hours[0]!.total.requests).toBe(1);
    });
  });

  describe("daily rollup", () => {
    it("reads empty for non-existent", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-rollup-"));
      const r = readDailyRollup(tempDir, "2026-02");
      expect(r.month).toBe("2026-02");
      expect(r.days).toEqual([]);
    });

    it("updates incrementally with dimensions", () => {
      const r: DailyRollup = { month: "2026-02", days: [] };
      updateDailyRollup(r, makeEvent({ tags: ["research", "ml"] }), "2026-02-26");
      updateDailyRollup(r, makeEvent({ casa: "coder", tags: [] }), "2026-02-26");
      updateDailyRollup(r, makeEvent(), "2026-02-27");

      expect(r.days).toHaveLength(2);
      const d26 = r.days.find(d => d.date === "2026-02-26")!;
      expect(d26.total.requests).toBe(2);
      expect(d26.byCasa["researcher"]!.requests).toBe(1);
      expect(d26.byCasa["coder"]!.requests).toBe(1);
      expect(d26.byTag["research"]!.requests).toBe(1);
      expect(d26.byTag["ml"]!.requests).toBe(1);
      expect(d26.byAuthProfile["personal"]!.requests).toBe(2);
      expect(d26.byWorkspace["/ws"]!.requests).toBe(2);
    });

    it("falls back to model when modelActual is empty", () => {
      const r: DailyRollup = { month: "2026-02", days: [] };
      updateDailyRollup(r, makeEvent({ modelActual: "", model: "claude-opus-4-6" }), "2026-02-26");
      const d = r.days[0]!;
      expect(d.byModel["claude-opus-4-6"]!.requests).toBe(1);
    });

    it("round-trips through write/read", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-rollup-"));
      const r: DailyRollup = { month: "2026-02", days: [] };
      updateDailyRollup(r, makeEvent(), "2026-02-26");
      writeDailyRollup(tempDir, r);

      const read = readDailyRollup(tempDir, "2026-02");
      expect(read.days).toHaveLength(1);
    });
  });

  describe("CASA rollup", () => {
    it("reads empty for non-existent", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-rollup-"));
      const r = readCasaRollup(tempDir, "researcher");
      expect(r.casa).toBe("researcher");
      expect(r.allTime.requests).toBe(0);
    });

    it("updates incrementally", () => {
      const r: CasaRollup = { casa: "researcher", allTime: emptySummary(), byModel: {}, byDay: [] };
      updateCasaRollup(r, makeEvent({ costUsd: 0.05 }), "2026-02-26");
      updateCasaRollup(r, makeEvent({ costUsd: 0.10 }), "2026-02-26");
      updateCasaRollup(r, makeEvent({ costUsd: 0.02 }), "2026-02-27");

      expect(r.allTime.requests).toBe(3);
      expect(r.allTime.costUsd).toBeCloseTo(0.17, 5);
      expect(r.byModel["claude-sonnet-4-6"]!.requests).toBe(3);
      expect(r.byDay).toHaveLength(2);
      expect(r.byDay.find(d => d.date === "2026-02-26")!.summary.requests).toBe(2);
    });

    it("falls back to model when modelActual is empty", () => {
      const r: CasaRollup = { casa: "researcher", allTime: emptySummary(), byModel: {}, byDay: [] };
      updateCasaRollup(r, makeEvent({ modelActual: "", model: "claude-opus-4-6" }), "2026-02-26");
      expect(r.byModel["claude-opus-4-6"]!.requests).toBe(1);
    });

    it("round-trips through write/read", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-rollup-"));
      const r: CasaRollup = { casa: "researcher", allTime: emptySummary(), byModel: {}, byDay: [] };
      updateCasaRollup(r, makeEvent(), "2026-02-26");
      writeCasaRollup(tempDir, r);

      const read = readCasaRollup(tempDir, "researcher");
      expect(read.allTime.requests).toBe(1);
    });
  });

  describe("safePath validation", () => {
    it("rejects invalid date segment in hourlyRollupPath", () => {
      expect(() => hourlyRollupPath("/tmp", "../etc")).toThrow("Invalid path segment");
    });

    it("rejects invalid month segment in dailyRollupPath", () => {
      expect(() => dailyRollupPath("/tmp", "../../x")).toThrow("Invalid path segment");
    });

    it("rejects invalid casa segment in casaRollupPath", () => {
      expect(() => casaRollupPath("/tmp", "../../etc")).toThrow("Invalid path segment");
    });
  });

  describe("flushRollups", () => {
    it("writes all rollups to disk", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-rollup-"));

      const hourly = new Map<string, HourlyRollup>();
      const h: HourlyRollup = { date: "2026-02-26", hours: [] };
      updateHourlyRollup(h, makeEvent());
      hourly.set("2026-02-26", h);

      const daily = new Map<string, DailyRollup>();
      const d: DailyRollup = { month: "2026-02", days: [] };
      updateDailyRollup(d, makeEvent(), "2026-02-26");
      daily.set("2026-02", d);

      const casa = new Map<string, CasaRollup>();
      const c: CasaRollup = { casa: "researcher", allTime: emptySummary(), byModel: {}, byDay: [] };
      updateCasaRollup(c, makeEvent(), "2026-02-26");
      casa.set("researcher", c);

      flushRollups(tempDir, hourly, daily, casa);

      expect(existsSync(join(tempDir, "rollups", "hourly", "2026-02-26.json"))).toBe(true);
      expect(existsSync(join(tempDir, "rollups", "daily", "2026-02.json"))).toBe(true);
      expect(existsSync(join(tempDir, "rollups", "casa", "researcher.json"))).toBe(true);
    });
  });
});
