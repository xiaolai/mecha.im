import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readScheduleConfig,
  writeScheduleConfig,
  readScheduleState,
  writeScheduleState,
  appendRunHistory,
  readRunHistory,
  removeScheduleData,
} from "../src/schedule-store.js";
import type { ScheduleConfig, ScheduleState, ScheduleRunResult } from "@mecha/core";

describe("schedule-store", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-schedule-store-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("readScheduleConfig", () => {
    it("returns empty config for missing file", () => {
      const config = readScheduleConfig(tempDir);
      expect(config.schedules).toEqual([]);
    });

    it("reads valid config", () => {
      const config: ScheduleConfig = {
        schedules: [
          {
            id: "test",
            trigger: { type: "interval", every: "5m", intervalMs: 300_000 },
            prompt: "Hello",
          },
        ],
        maxRunsPerDay: 10,
      };
      writeScheduleConfig(tempDir, config);
      const result = readScheduleConfig(tempDir);
      expect(result).toEqual(config);
    });
  });

  describe("writeScheduleConfig", () => {
    it("creates directory if needed", () => {
      const nested = join(tempDir, "deep", "dir");
      writeScheduleConfig(nested, { schedules: [] });
      expect(existsSync(join(nested, "schedule.json"))).toBe(true);
    });

    it("overwrites existing config", () => {
      writeScheduleConfig(tempDir, { schedules: [] });
      const config: ScheduleConfig = {
        schedules: [{
          id: "a",
          trigger: { type: "interval", every: "1m", intervalMs: 60_000 },
          prompt: "test",
        }],
      };
      writeScheduleConfig(tempDir, config);
      expect(readScheduleConfig(tempDir)).toEqual(config);
    });
  });

  describe("readScheduleState / writeScheduleState", () => {
    it("returns undefined for missing state", () => {
      expect(readScheduleState(tempDir, "nonexistent")).toBeUndefined();
    });

    it("round-trips state", () => {
      const state: ScheduleState = {
        runCount: 5,
        todayDate: "2026-02-25",
        runsToday: 3,
        lastRunAt: "2026-02-25T10:00:00Z",
        nextRunAt: "2026-02-25T10:05:00Z",
        consecutiveErrors: 0,
      };
      writeScheduleState(tempDir, "my-schedule", state);
      expect(readScheduleState(tempDir, "my-schedule")).toEqual(state);
    });

    it("overwrites existing state", () => {
      const state1: ScheduleState = { runCount: 1, todayDate: "2026-02-25", runsToday: 1 };
      const state2: ScheduleState = { runCount: 2, todayDate: "2026-02-25", runsToday: 2 };
      writeScheduleState(tempDir, "s1", state1);
      writeScheduleState(tempDir, "s1", state2);
      expect(readScheduleState(tempDir, "s1")).toEqual(state2);
    });
  });

  describe("appendRunHistory / readRunHistory", () => {
    it("returns empty array for no history", () => {
      expect(readRunHistory(tempDir, "s1")).toEqual([]);
    });

    it("appends and reads history", () => {
      const r1: ScheduleRunResult = {
        scheduleId: "s1",
        startedAt: "2026-02-25T10:00:00Z",
        completedAt: "2026-02-25T10:00:01Z",
        durationMs: 1000,
        outcome: "success",
      };
      const r2: ScheduleRunResult = {
        scheduleId: "s1",
        startedAt: "2026-02-25T10:05:00Z",
        completedAt: "2026-02-25T10:05:02Z",
        durationMs: 2000,
        outcome: "error",
        error: "Something failed",
      };
      appendRunHistory(tempDir, "s1", r1);
      appendRunHistory(tempDir, "s1", r2);
      const history = readRunHistory(tempDir, "s1");
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual(r1);
      expect(history[1]).toEqual(r2);
    });

    it("respects limit parameter (returns last N)", () => {
      for (let i = 0; i < 5; i++) {
        appendRunHistory(tempDir, "s1", {
          scheduleId: "s1",
          startedAt: `2026-02-25T10:0${i}:00Z`,
          completedAt: `2026-02-25T10:0${i}:01Z`,
          durationMs: 100,
          outcome: "success",
        });
      }
      const history = readRunHistory(tempDir, "s1", 2);
      expect(history).toHaveLength(2);
      expect(history[0]!.startedAt).toBe("2026-02-25T10:03:00Z");
      expect(history[1]!.startedAt).toBe("2026-02-25T10:04:00Z");
    });
  });

  describe("removeScheduleData", () => {
    it("removes schedule directory", () => {
      writeScheduleState(tempDir, "s1", { runCount: 1, todayDate: "2026-02-25", runsToday: 1 });
      appendRunHistory(tempDir, "s1", {
        scheduleId: "s1",
        startedAt: "2026-02-25T10:00:00Z",
        completedAt: "2026-02-25T10:00:01Z",
        durationMs: 100,
        outcome: "success",
      });
      expect(existsSync(join(tempDir, "schedules", "s1"))).toBe(true);
      removeScheduleData(tempDir, "s1");
      expect(existsSync(join(tempDir, "schedules", "s1"))).toBe(false);
    });

    it("no-op for nonexistent schedule", () => {
      removeScheduleData(tempDir, "nonexistent");
      // Should not throw
    });
  });

  describe("path traversal guard", () => {
    it("rejects schedule IDs with path traversal", () => {
      expect(() => readScheduleState(tempDir, "../etc")).toThrow("Invalid schedule ID");
    });

    it("rejects schedule IDs with invalid characters", () => {
      expect(() => writeScheduleState(tempDir, "bad/id", {
        runCount: 0, todayDate: "2026-02-25", runsToday: 0,
      })).toThrow("Invalid schedule ID");
    });
  });
});
