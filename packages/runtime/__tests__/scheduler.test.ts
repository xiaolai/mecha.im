import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createScheduleEngine, type ChatFn, type ScheduleEngine } from "../src/scheduler.js";
import {
  type ScheduleEntry,
  ScheduleNotFoundError,
  DuplicateScheduleError,
  InvalidIntervalError,
} from "@mecha/core";
import { readRunHistory, readScheduleConfig } from "@mecha/process";

function makeEntry(id: string, intervalMs: number, prompt = "test prompt"): ScheduleEntry {
  const every = intervalMs >= 3_600_000
    ? `${intervalMs / 3_600_000}h`
    : intervalMs >= 60_000
      ? `${intervalMs / 60_000}m`
      : `${intervalMs / 1_000}s`;
  return {
    id,
    trigger: { type: "interval", every, intervalMs },
    prompt,
  };
}

describe("createScheduleEngine", () => {
  let tempDir: string;
  let chatFn: ChatFn;
  let engine: ScheduleEngine;
  let currentTime: number;

  beforeEach(() => {
    vi.useFakeTimers();
    tempDir = mkdtempSync(join(tmpdir(), "mecha-scheduler-test-"));
    currentTime = new Date("2026-02-25T10:00:00Z").getTime();
    chatFn = vi.fn<ChatFn>().mockResolvedValue({ durationMs: 100 });
    engine = createScheduleEngine({
      casaDir: tempDir,
      casaName: "test-casa",
      chatFn,
      now: () => currentTime,
    });
  });

  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("addSchedule / listSchedules", () => {
    it("adds and lists a schedule", () => {
      const entry = makeEntry("inbox", 60_000);
      engine.addSchedule(entry);
      const list = engine.listSchedules();
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe("inbox");
    });

    it("rejects duplicate schedule IDs", () => {
      engine.addSchedule(makeEntry("dup", 60_000));
      expect(() => engine.addSchedule(makeEntry("dup", 120_000))).toThrow(DuplicateScheduleError);
    });

    it("rejects invalid interval", () => {
      const entry: ScheduleEntry = {
        id: "bad",
        trigger: { type: "interval", every: "5s", intervalMs: 5000 },
        prompt: "test",
      };
      expect(() => engine.addSchedule(entry)).toThrow(InvalidIntervalError);
    });
  });

  describe("removeSchedule", () => {
    it("removes a schedule", () => {
      engine.addSchedule(makeEntry("rm-me", 60_000));
      engine.removeSchedule("rm-me");
      expect(engine.listSchedules()).toHaveLength(0);
    });

    it("throws for unknown schedule", () => {
      expect(() => engine.removeSchedule("nope")).toThrow(ScheduleNotFoundError);
    });
  });

  describe("pauseSchedule / resumeSchedule", () => {
    it("pauses a specific schedule", () => {
      engine.addSchedule(makeEntry("p1", 60_000));
      engine.pauseSchedule("p1");
      const list = engine.listSchedules();
      expect(list[0]!.paused).toBe(true);
    });

    it("resumes a specific schedule", () => {
      const entry = makeEntry("p2", 60_000);
      entry.paused = true;
      engine.addSchedule(entry);
      engine.resumeSchedule("p2");
      expect(engine.listSchedules()[0]!.paused).toBe(false);
    });

    it("pauses all schedules", () => {
      engine.addSchedule(makeEntry("a", 60_000));
      engine.addSchedule(makeEntry("b", 120_000));
      engine.pauseSchedule();
      expect(engine.listSchedules().every((s) => s.paused)).toBe(true);
    });

    it("resumes all schedules", () => {
      const e1 = makeEntry("a", 60_000);
      e1.paused = true;
      const e2 = makeEntry("b", 120_000);
      e2.paused = true;
      engine.addSchedule(e1);
      engine.addSchedule(e2);
      engine.resumeSchedule();
      expect(engine.listSchedules().every((s) => !s.paused)).toBe(true);
    });

    it("throws for unknown schedule", () => {
      expect(() => engine.pauseSchedule("nope")).toThrow(ScheduleNotFoundError);
      expect(() => engine.resumeSchedule("nope")).toThrow(ScheduleNotFoundError);
    });
  });

  describe("triggerNow", () => {
    it("executes a run and records history", async () => {
      engine.addSchedule(makeEntry("run-test", 60_000));
      const result = await engine.triggerNow("run-test");
      expect(result.outcome).toBe("success");
      expect(result.durationMs).toBe(100);
      expect(chatFn).toHaveBeenCalledWith("test prompt");

      const history = engine.getHistory("run-test");
      expect(history).toHaveLength(1);
      expect(history[0]!.outcome).toBe("success");
    });

    it("records error outcome when chatFn returns error", async () => {
      (chatFn as ReturnType<typeof vi.fn>).mockResolvedValue({ durationMs: 50, error: "API down" });
      engine.addSchedule(makeEntry("err-test", 60_000));
      const result = await engine.triggerNow("err-test");
      expect(result.outcome).toBe("error");
      expect(result.error).toBe("API down");
    });

    it("records error outcome when chatFn throws", async () => {
      (chatFn as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network failure"));
      engine.addSchedule(makeEntry("throw-test", 60_000));
      const result = await engine.triggerNow("throw-test");
      expect(result.outcome).toBe("error");
      expect(result.error).toBe("Network failure");
    });

    it("throws for unknown schedule", async () => {
      await expect(engine.triggerNow("nope")).rejects.toThrow(ScheduleNotFoundError);
    });
  });

  describe("timer execution", () => {
    it("fires schedule after interval", async () => {
      engine.addSchedule(makeEntry("timer-test", 60_000));
      engine.start();

      // Advance time past the interval
      currentTime += 60_000;
      await vi.advanceTimersByTimeAsync(60_000);

      expect(chatFn).toHaveBeenCalledTimes(1);
      const history = readRunHistory(tempDir, "timer-test");
      expect(history).toHaveLength(1);
    });

    it("does not fire paused schedules", async () => {
      const entry = makeEntry("paused-timer", 60_000);
      entry.paused = true;
      engine.addSchedule(entry);
      engine.start();

      currentTime += 120_000;
      await vi.advanceTimersByTimeAsync(120_000);

      expect(chatFn).not.toHaveBeenCalled();
    });

    it("stops timers on stop()", async () => {
      engine.addSchedule(makeEntry("stop-test", 60_000));
      engine.start();
      engine.stop();

      currentTime += 120_000;
      await vi.advanceTimersByTimeAsync(120_000);

      expect(chatFn).not.toHaveBeenCalled();
    });
  });

  describe("budget enforcement", () => {
    it("skips run when daily budget exceeded", async () => {
      engine.addSchedule(makeEntry("budget-test", 60_000));
      engine.start();

      for (let i = 0; i < 50; i++) {
        await engine.triggerNow("budget-test");
      }

      const result = await engine.triggerNow("budget-test");
      expect(result.outcome).toBe("skipped");
      expect(result.error).toContain("budget exceeded");
    });

    it("resets daily counter when date changes", async () => {
      engine.addSchedule(makeEntry("day-reset", 60_000));
      engine.start();

      // Exhaust budget
      for (let i = 0; i < 50; i++) {
        await engine.triggerNow("day-reset");
      }
      const skipped = await engine.triggerNow("day-reset");
      expect(skipped.outcome).toBe("skipped");

      // Advance to next day
      currentTime += 24 * 60 * 60 * 1000;

      // Should succeed again — new day resets counter
      const result = await engine.triggerNow("day-reset");
      expect(result.outcome).toBe("success");
    });

    it("aggregates budget across multiple schedules", async () => {
      engine.addSchedule(makeEntry("multi-a", 60_000));
      engine.addSchedule(makeEntry("multi-b", 60_000));
      engine.start();

      // Run 25 times on each schedule (50 total = budget limit)
      for (let i = 0; i < 25; i++) {
        await engine.triggerNow("multi-a");
        await engine.triggerNow("multi-b");
      }

      // Both should be skipped — CASA-level budget exhausted
      const resultA = await engine.triggerNow("multi-a");
      const resultB = await engine.triggerNow("multi-b");
      expect(resultA.outcome).toBe("skipped");
      expect(resultB.outcome).toBe("skipped");
    });
  });

  describe("concurrency guard", () => {
    it("skips if another run is in progress", async () => {
      // Make chatFn hang
      let resolveChat: ((v: { durationMs: number }) => void) | undefined;
      (chatFn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        return new Promise<{ durationMs: number }>((resolve) => {
          resolveChat = resolve;
        });
      });

      engine.addSchedule(makeEntry("conc-a", 60_000));
      engine.addSchedule(makeEntry("conc-b", 60_000));

      // Start first run (will hang)
      const runA = engine.triggerNow("conc-a");

      // Try second run while first is in progress
      const resultB = await engine.triggerNow("conc-b");
      expect(resultB.outcome).toBe("skipped");
      expect(resultB.error).toContain("already running");

      // Clean up
      resolveChat!({ durationMs: 100 });
      await runA;
    });
  });

  it("handles chatFn throwing a non-Error value", async () => {
    (chatFn as ReturnType<typeof vi.fn>).mockRejectedValue("string-error");
    engine.addSchedule(makeEntry("non-err", 60_000));
    const result = await engine.triggerNow("non-err");
    expect(result.outcome).toBe("error");
    expect(result.error).toBe("string-error");
  });

  describe("consecutive error auto-pause", () => {
    it("auto-pauses after MAX_CONSECUTIVE_ERRORS", async () => {
      (chatFn as ReturnType<typeof vi.fn>).mockResolvedValue({ durationMs: 10, error: "fail" });
      engine.addSchedule(makeEntry("auto-pause", 60_000));

      for (let i = 0; i < 5; i++) {
        await engine.triggerNow("auto-pause");
      }

      const config = readScheduleConfig(tempDir);
      const entry = config.schedules.find((s) => s.id === "auto-pause");
      expect(entry?.paused).toBe(true);
    });
  });

  describe("getHistory", () => {
    it("returns empty for no history", () => {
      engine.addSchedule(makeEntry("no-hist", 60_000));
      expect(engine.getHistory("no-hist")).toEqual([]);
    });

    it("respects limit", async () => {
      engine.addSchedule(makeEntry("hist-limit", 60_000));
      for (let i = 0; i < 5; i++) {
        await engine.triggerNow("hist-limit");
      }
      expect(engine.getHistory("hist-limit", 2)).toHaveLength(2);
    });

    it("throws for unknown schedule", () => {
      expect(() => engine.getHistory("ghost")).toThrow(ScheduleNotFoundError);
    });
  });

  it("arms timer when adding schedule to a running engine", async () => {
    engine.start();
    engine.addSchedule(makeEntry("live-add", 60_000));

    // Advance past interval — should fire
    currentTime += 60_000;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(chatFn).toHaveBeenCalledTimes(1);
  });

  it("uses nextRunAt from persisted state when arming timers", async () => {
    // Add schedule and run once to populate state
    engine.addSchedule(makeEntry("next-at", 60_000));
    await engine.triggerNow("next-at");
    engine.stop();

    // Create a new engine and start it — armTimer reads nextRunAt from state
    const engine2 = createScheduleEngine({
      casaDir: tempDir,
      casaName: "test-casa",
      chatFn,
      now: () => currentTime,
    });
    engine2.start();

    // Advance past interval — should fire using persisted nextRunAt
    currentTime += 60_000;
    await vi.advanceTimersByTimeAsync(60_000);

    // chatFn was called once by triggerNow above, and once by the timer
    expect(chatFn).toHaveBeenCalledTimes(2);

    engine2.stop();
  });

  describe("restart recovery", () => {
    it("recovers schedules from persisted state on start()", async () => {
      // Add schedule and run once
      engine.addSchedule(makeEntry("recover", 60_000));
      await engine.triggerNow("recover");
      engine.stop();

      // Create a new engine (simulates restart)
      const engine2 = createScheduleEngine({
        casaDir: tempDir,
        casaName: "test-casa",
        chatFn,
        now: () => currentTime,
      });

      const list = engine2.listSchedules();
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe("recover");

      // History survives restart
      const history = engine2.getHistory("recover");
      expect(history).toHaveLength(1);

      engine2.stop();
    });
  });
});
