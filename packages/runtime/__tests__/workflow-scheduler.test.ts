import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "js-yaml";
import { createWorkflowScheduler, type WorkflowScheduler } from "../src/workflow-scheduler.js";

function makeWorkflowYaml(name: string, schedule: string): string {
  return YAML.dump({
    name,
    trigger: { schedule },
    steps: {
      greet: { bot: "alice", prompt: "Hello" },
    },
  });
}

describe("createWorkflowScheduler", () => {
  let workflowsDir: string;
  let stateDir: string;
  let runWorkflow: ReturnType<typeof vi.fn>;
  let scheduler: WorkflowScheduler;
  let currentTime: number;

  beforeEach(() => {
    vi.useFakeTimers();
    const tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-scheduler-test-"));
    workflowsDir = join(tempDir, "workflows");
    stateDir = join(tempDir, "workflow-schedules");
    mkdirSync(workflowsDir, { recursive: true });
    currentTime = new Date("2026-03-24T10:00:00Z").getTime();
    runWorkflow = vi.fn<(name: string) => Promise<void>>().mockResolvedValue(undefined);
  });

  afterEach(() => {
    scheduler?.stop();
    vi.useRealTimers();
    // Clean up temp dirs
    const base = workflowsDir.replace(/\/workflows$/, "");
    rmSync(base, { recursive: true, force: true });
  });

  function createScheduler() {
    scheduler = createWorkflowScheduler({
      workflowsDir,
      stateDir,
      runWorkflow,
      now: () => currentTime,
    });
    return scheduler;
  }

  describe("scanning", () => {
    it("scans workflows dir and finds scheduled workflows", () => {
      writeFileSync(join(workflowsDir, "daily-report.yaml"), makeWorkflowYaml("daily-report", "1h"));
      writeFileSync(join(workflowsDir, "cleanup.yml"), makeWorkflowYaml("cleanup", "30m"));

      const s = createScheduler();
      s.start();

      const list = s.list();
      expect(list).toHaveLength(2);
      const names = list.map((e) => e.name).sort();
      expect(names).toEqual(["cleanup", "daily-report"]);
    });

    it("does not schedule workflows without trigger.schedule", () => {
      // Write a workflow with no trigger.schedule
      const yaml = YAML.dump({
        name: "manual-only",
        trigger: { manual: true },
        steps: { greet: { bot: "alice", prompt: "Hello" } },
      });
      writeFileSync(join(workflowsDir, "manual-only.yaml"), yaml);

      const s = createScheduler();
      s.start();

      expect(s.list()).toHaveLength(0);
    });

    it("skips files with invalid schedule expressions", () => {
      const logFn = vi.fn();
      writeFileSync(join(workflowsDir, "bad.yaml"), makeWorkflowYaml("bad-wf", "invalid-expr"));

      scheduler = createWorkflowScheduler({
        workflowsDir,
        stateDir,
        runWorkflow,
        now: () => currentTime,
        log: logFn,
      });
      scheduler.start();

      expect(scheduler.list()).toHaveLength(0);
      expect(logFn).toHaveBeenCalledWith("warn", expect.stringContaining("Invalid schedule"));
    });

    it("handles missing workflows directory gracefully", () => {
      const missingDir = join(workflowsDir, "nonexistent");
      scheduler = createWorkflowScheduler({
        workflowsDir: missingDir,
        stateDir,
        runWorkflow,
        now: () => currentTime,
      });
      scheduler.start();
      expect(scheduler.list()).toHaveLength(0);
    });
  });

  describe("interval scheduling", () => {
    it("arms timer for interval-based schedule and fires at the right time", async () => {
      writeFileSync(join(workflowsDir, "hourly.yaml"), makeWorkflowYaml("hourly", "1h"));

      const s = createScheduler();
      s.start();

      // Not yet fired
      expect(runWorkflow).not.toHaveBeenCalled();

      // Advance past 1 hour
      currentTime += 3_600_000;
      await vi.advanceTimersByTimeAsync(3_600_000);

      expect(runWorkflow).toHaveBeenCalledTimes(1);
      expect(runWorkflow).toHaveBeenCalledWith("hourly");
    });

    it("chains timers — fires again after second interval", async () => {
      writeFileSync(join(workflowsDir, "repeat.yaml"), makeWorkflowYaml("repeat", "30m"));

      const s = createScheduler();
      s.start();

      // First fire
      currentTime += 30 * 60_000;
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(runWorkflow).toHaveBeenCalledTimes(1);

      // Second fire
      currentTime += 30 * 60_000;
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(runWorkflow).toHaveBeenCalledTimes(2);
    });
  });

  describe("cron scheduling", () => {
    it("arms timer for cron-based schedule", async () => {
      // Cron: every hour at minute 0 — "0 * * * *"
      writeFileSync(join(workflowsDir, "cron-job.yaml"), makeWorkflowYaml("cron-job", "0 * * * *"));

      const s = createScheduler();
      s.start();

      const list = s.list();
      expect(list).toHaveLength(1);
      expect(list[0]!.schedule).toBe("0 * * * *");
      // nextRunAt should be set to the next hour boundary
      expect(list[0]!.nextRunAt).toBeDefined();

      // Current time is 10:00:00 UTC — next cron match is 11:00:00 UTC (60 min)
      currentTime += 60 * 60_000;
      await vi.advanceTimersByTimeAsync(60 * 60_000);

      expect(runWorkflow).toHaveBeenCalledTimes(1);
      expect(runWorkflow).toHaveBeenCalledWith("cron-job");
    });
  });

  describe("stop()", () => {
    it("clears all timers so no workflows fire", async () => {
      writeFileSync(join(workflowsDir, "stop-test.yaml"), makeWorkflowYaml("stop-test", "1h"));

      const s = createScheduler();
      s.start();
      s.stop();

      // Advance well past the interval
      currentTime += 2 * 3_600_000;
      await vi.advanceTimersByTimeAsync(2 * 3_600_000);

      expect(runWorkflow).not.toHaveBeenCalled();
    });
  });

  describe("list()", () => {
    it("returns correct info for scheduled workflows", () => {
      writeFileSync(join(workflowsDir, "a.yaml"), makeWorkflowYaml("alpha", "1h"));
      writeFileSync(join(workflowsDir, "b.yaml"), makeWorkflowYaml("beta", "30m"));

      const s = createScheduler();
      s.start();

      const list = s.list();
      expect(list).toHaveLength(2);
      for (const item of list) {
        expect(item.paused).toBe(false);
        expect(item.nextRunAt).toBeDefined();
        expect(item.name).toBeTruthy();
        expect(item.schedule).toBeTruthy();
      }
    });

    it("does not include nextRunAt for paused workflows", () => {
      writeFileSync(join(workflowsDir, "paused.yaml"), makeWorkflowYaml("paused-wf", "1h"));
      // Pre-persist paused state
      const dir = join(stateDir, "paused-wf");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "state.json"), JSON.stringify({ consecutiveErrors: 0, paused: true }));

      const s = createScheduler();
      s.start();

      const list = s.list();
      expect(list).toHaveLength(1);
      expect(list[0]!.paused).toBe(true);
      expect(list[0]!.nextRunAt).toBeUndefined();
    });
  });

  describe("state persistence", () => {
    it("persists lastRunAt after a successful run", async () => {
      writeFileSync(join(workflowsDir, "persist.yaml"), makeWorkflowYaml("persist-wf", "1h"));

      const s = createScheduler();
      s.start();

      currentTime += 3_600_000;
      await vi.advanceTimersByTimeAsync(3_600_000);

      const statePath = join(stateDir, "persist-wf", "state.json");
      expect(existsSync(statePath)).toBe(true);
      const state = JSON.parse(readFileSync(statePath, "utf-8"));
      expect(state.lastRunAt).toBeDefined();
      expect(state.consecutiveErrors).toBe(0);
      expect(state.paused).toBe(false);
    });

    it("restores state from persisted file on start", () => {
      writeFileSync(join(workflowsDir, "restore.yaml"), makeWorkflowYaml("restore-wf", "1h"));
      const dir = join(stateDir, "restore-wf");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "state.json"), JSON.stringify({
        lastRunAt: "2026-03-24T09:00:00.000Z",
        consecutiveErrors: 2,
        paused: false,
      }));

      const s = createScheduler();
      s.start();

      const list = s.list();
      expect(list).toHaveLength(1);
      expect(list[0]!.lastRunAt).toBe("2026-03-24T09:00:00.000Z");
    });
  });

  describe("error handling", () => {
    it("increments consecutiveErrors on failure", async () => {
      writeFileSync(join(workflowsDir, "fail.yaml"), makeWorkflowYaml("fail-wf", "1h"));
      runWorkflow.mockRejectedValue(new Error("boom"));

      const s = createScheduler();
      s.start();

      currentTime += 3_600_000;
      await vi.advanceTimersByTimeAsync(3_600_000);

      const state = JSON.parse(readFileSync(join(stateDir, "fail-wf", "state.json"), "utf-8"));
      expect(state.consecutiveErrors).toBe(1);
      expect(state.paused).toBe(false);
    });

    it("auto-pauses after 5 consecutive errors", async () => {
      writeFileSync(join(workflowsDir, "flaky.yaml"), makeWorkflowYaml("flaky-wf", "30m"));
      runWorkflow.mockRejectedValue(new Error("fail"));

      const s = createScheduler();
      s.start();

      // Fire 5 times (30m interval)
      for (let i = 0; i < 5; i++) {
        currentTime += 30 * 60_000;
        await vi.advanceTimersByTimeAsync(30 * 60_000);
      }

      const state = JSON.parse(readFileSync(join(stateDir, "flaky-wf", "state.json"), "utf-8"));
      expect(state.consecutiveErrors).toBe(5);
      expect(state.paused).toBe(true);

      // Should not fire again
      currentTime += 30 * 60_000;
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(runWorkflow).toHaveBeenCalledTimes(5);
    });

    it("resets consecutiveErrors on success", async () => {
      writeFileSync(join(workflowsDir, "recover.yaml"), makeWorkflowYaml("recover-wf", "1h"));

      // Fail twice, then succeed
      runWorkflow
        .mockRejectedValueOnce(new Error("fail"))
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValue(undefined);

      const s = createScheduler();
      s.start();

      // First failure
      currentTime += 3_600_000;
      await vi.advanceTimersByTimeAsync(3_600_000);

      // Second failure
      currentTime += 3_600_000;
      await vi.advanceTimersByTimeAsync(3_600_000);

      let state = JSON.parse(readFileSync(join(stateDir, "recover-wf", "state.json"), "utf-8"));
      expect(state.consecutiveErrors).toBe(2);

      // Success
      currentTime += 3_600_000;
      await vi.advanceTimersByTimeAsync(3_600_000);

      state = JSON.parse(readFileSync(join(stateDir, "recover-wf", "state.json"), "utf-8"));
      expect(state.consecutiveErrors).toBe(0);
    });
  });

  describe("paused workflows", () => {
    it("does not arm timer for paused workflows", async () => {
      writeFileSync(join(workflowsDir, "paused.yaml"), makeWorkflowYaml("paused-wf", "1h"));
      const dir = join(stateDir, "paused-wf");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "state.json"), JSON.stringify({ consecutiveErrors: 0, paused: true }));

      const s = createScheduler();
      s.start();

      currentTime += 2 * 3_600_000;
      await vi.advanceTimersByTimeAsync(2 * 3_600_000);

      expect(runWorkflow).not.toHaveBeenCalled();
    });
  });
});
