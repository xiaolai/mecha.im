import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createScheduleEngine, type ChatFn, type ScheduleEngine } from "../src/scheduler.js";
import { executeRun, type RunDeps } from "../src/schedule-runner.js";
import {
  type ScheduleEntry,
  ScheduleNotFoundError,
  DuplicateScheduleError,
  InvalidIntervalError,
  ScheduleLimitError,
  SCHEDULE_DEFAULTS,
} from "@mecha/core";
import { readRunHistory, readScheduleConfig, writeScheduleConfig } from "@mecha/process";

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
      botDir: tempDir,
      botName: "test-bot",
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

    it("rejects when schedule limit reached", () => {
      for (let i = 0; i < SCHEDULE_DEFAULTS.MAX_SCHEDULES_PER_BOT; i++) {
        engine.addSchedule(makeEntry(`s-${i}`, 60_000));
      }
      expect(() => engine.addSchedule(makeEntry("one-too-many", 60_000))).toThrow(ScheduleLimitError);
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
      expect(chatFn).toHaveBeenCalledWith("test prompt", expect.any(AbortSignal));

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

    it("clears pending timer to prevent double-run", async () => {
      engine.addSchedule(makeEntry("timer-reset", 60_000));
      engine.start();

      // Manually trigger halfway through the interval
      currentTime += 30_000;
      await engine.triggerNow("timer-reset");
      expect(chatFn).toHaveBeenCalledTimes(1);

      // Advance past original timer time — should NOT double-fire
      // (only the re-armed timer at +60s from now should fire)
      currentTime += 30_000;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(chatFn).toHaveBeenCalledTimes(1);

      // Advance to the re-armed time — should fire
      currentTime += 30_000;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(chatFn).toHaveBeenCalledTimes(2);
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

  describe("budget enforcement (automatic runs)", () => {
    function makeRunDeps(overrides?: Partial<RunDeps>): RunDeps {
      let activeRun: string | undefined;
      return {
        botDir: tempDir,
        chatFn,
        now: () => currentTime,
        log: () => {},
        getActiveRun: () => activeRun,
        setActiveRun: (id) => { activeRun = id; },
        ...overrides,
      };
    }

    it("skips automatic run when daily budget exceeded", async () => {
      // Set low budget for fast testing
      engine.addSchedule(makeEntry("budget-test", 60_000));
      writeScheduleConfig(tempDir, { schedules: readScheduleConfig(tempDir).schedules, maxRunsPerDay: 3 });

      const deps = makeRunDeps();
      const entry = makeEntry("budget-test", 60_000);

      for (let i = 0; i < 3; i++) {
        await executeRun(entry, deps);
      }

      const result = await executeRun(entry, deps);
      expect(result.outcome).toBe("skipped");
      expect(result.error).toContain("budget exceeded");
    });

    it("triggerNow (manual) bypasses budget", async () => {
      engine.addSchedule(makeEntry("manual-budget", 60_000));
      writeScheduleConfig(tempDir, { schedules: readScheduleConfig(tempDir).schedules, maxRunsPerDay: 3 });

      const deps = makeRunDeps();
      const entry = makeEntry("manual-budget", 60_000);

      // Exhaust budget via automatic runs
      for (let i = 0; i < 3; i++) {
        await executeRun(entry, deps);
      }

      // Manual trigger should still work
      const result = await engine.triggerNow("manual-budget");
      expect(result.outcome).toBe("success");
    });

    it("resets daily counter when date changes", async () => {
      engine.addSchedule(makeEntry("day-reset", 60_000));
      writeScheduleConfig(tempDir, { schedules: readScheduleConfig(tempDir).schedules, maxRunsPerDay: 3 });

      const deps = makeRunDeps();
      const entry = makeEntry("day-reset", 60_000);

      // Exhaust budget
      for (let i = 0; i < 3; i++) {
        await executeRun(entry, deps);
      }
      const skipped = await executeRun(entry, deps);
      expect(skipped.outcome).toBe("skipped");

      // Advance to next day
      currentTime += 24 * 60 * 60 * 1000;

      const result = await executeRun(entry, deps);
      expect(result.outcome).toBe("success");
    });

    it("aggregates budget across multiple schedules", async () => {
      engine.addSchedule(makeEntry("multi-a", 60_000));
      engine.addSchedule(makeEntry("multi-b", 60_000));
      writeScheduleConfig(tempDir, { schedules: readScheduleConfig(tempDir).schedules, maxRunsPerDay: 4 });

      const deps = makeRunDeps();
      const entryA = makeEntry("multi-a", 60_000);
      const entryB = makeEntry("multi-b", 60_000);

      // Run 2 times on each schedule (4 total = budget limit)
      for (let i = 0; i < 2; i++) {
        await executeRun(entryA, deps);
        await executeRun(entryB, deps);
      }

      // Both should be skipped — bot-level budget exhausted
      const resultA = await executeRun(entryA, deps);
      const resultB = await executeRun(entryB, deps);
      expect(resultA.outcome).toBe("skipped");
      expect(resultB.outcome).toBe("skipped");
    });
  });

  describe("concurrency guard", () => {
    it("skips automatic run if another is in progress", async () => {
      let activeRun: string | undefined;
      const deps: RunDeps = {
        botDir: tempDir,
        chatFn,
        now: () => currentTime,
        log: () => {},
        getActiveRun: () => activeRun,
        setActiveRun: (id) => { activeRun = id; },
      };

      // Make chatFn hang
      let resolveChat: ((v: { durationMs: number }) => void) | undefined;
      (chatFn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        return new Promise<{ durationMs: number }>((resolve) => {
          resolveChat = resolve;
        });
      });

      engine.addSchedule(makeEntry("conc-a", 60_000));
      engine.addSchedule(makeEntry("conc-b", 60_000));

      // Start first run (will hang) — automatic (non-manual)
      const entryA = makeEntry("conc-a", 60_000);
      const runA = executeRun(entryA, deps);

      // Try second automatic run while first is in progress
      const entryB = makeEntry("conc-b", 60_000);
      const resultB = await executeRun(entryB, deps);
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
    it("auto-pauses after MAX_CONSECUTIVE_ERRORS (automatic runs)", async () => {
      (chatFn as ReturnType<typeof vi.fn>).mockResolvedValue({ durationMs: 10, error: "fail" });
      engine.addSchedule(makeEntry("auto-pause", 60_000));

      let activeRun: string | undefined;
      const deps: RunDeps = {
        botDir: tempDir,
        chatFn,
        now: () => currentTime,
        log: () => {},
        getActiveRun: () => activeRun,
        setActiveRun: (id) => { activeRun = id; },
      };
      const entry = makeEntry("auto-pause", 60_000);

      for (let i = 0; i < SCHEDULE_DEFAULTS.MAX_CONSECUTIVE_ERRORS; i++) {
        await executeRun(entry, deps);
      }

      const config = readScheduleConfig(tempDir);
      const found = config.schedules.find((s) => s.id === "auto-pause");
      expect(found?.paused).toBe(true);
    });

    it("triggerNow (manual) does not increment consecutiveErrors", async () => {
      (chatFn as ReturnType<typeof vi.fn>).mockResolvedValue({ durationMs: 10, error: "fail" });
      engine.addSchedule(makeEntry("manual-err", 60_000));

      // Run MAX_CONSECUTIVE_ERRORS times via manual trigger
      for (let i = 0; i < SCHEDULE_DEFAULTS.MAX_CONSECUTIVE_ERRORS; i++) {
        await engine.triggerNow("manual-err");
      }

      // Should NOT be auto-paused because manual runs don't count
      const config = readScheduleConfig(tempDir);
      const found = config.schedules.find((s) => s.id === "manual-err");
      expect(found?.paused).toBeUndefined();
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
      botDir: tempDir,
      botName: "test-bot",
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
        botDir: tempDir,
        botName: "test-bot",
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
