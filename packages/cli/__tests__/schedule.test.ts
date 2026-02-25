import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProgram } from "../src/program.js";
import { makeDeps } from "./test-utils.js";
import type { CommandDeps } from "../src/types.js";

// Mock the service layer
vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    casaScheduleAdd: vi.fn(),
    casaScheduleRemove: vi.fn(),
    casaScheduleList: vi.fn().mockResolvedValue([]),
    casaSchedulePause: vi.fn(),
    casaScheduleResume: vi.fn(),
    casaScheduleRun: vi.fn().mockResolvedValue({
      scheduleId: "test",
      startedAt: "2026-02-25T10:00:00Z",
      completedAt: "2026-02-25T10:00:01Z",
      durationMs: 100,
      outcome: "success",
    }),
    casaScheduleHistory: vi.fn().mockResolvedValue([]),
  };
});

import {
  casaScheduleAdd,
  casaScheduleList,
  casaScheduleRemove,
  casaSchedulePause,
  casaScheduleResume,
  casaScheduleRun,
  casaScheduleHistory,
} from "@mecha/service";

describe("schedule commands", () => {
  let deps: CommandDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply default mock return values after clearAllMocks
    (casaScheduleList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (casaScheduleRun as ReturnType<typeof vi.fn>).mockResolvedValue({
      scheduleId: "test",
      startedAt: "2026-02-25T10:00:00Z",
      completedAt: "2026-02-25T10:00:01Z",
      durationMs: 100,
      outcome: "success",
    });
    (casaScheduleHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    deps = makeDeps({
      pm: {
        getPortAndToken: vi.fn().mockReturnValue({ port: 7700, token: "t" }),
        get: vi.fn().mockReturnValue({ name: "alice", state: "running" }),
      },
    });
  });

  function run(args: string[]) {
    const program = createProgram(deps);
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    return program.parseAsync(["node", "mecha", ...args]);
  }

  it("registers schedule command with subcommands", () => {
    const program = createProgram(deps);
    const scheduleCmd = program.commands.find((c) => c.name() === "schedule");
    expect(scheduleCmd).toBeDefined();
    const subNames = scheduleCmd!.commands.map((c) => c.name());
    expect(subNames).toContain("add");
    expect(subNames).toContain("list");
    expect(subNames).toContain("remove");
    expect(subNames).toContain("pause");
    expect(subNames).toContain("resume");
    expect(subNames).toContain("run");
    expect(subNames).toContain("history");
  });

  it("schedule add calls casaScheduleAdd", async () => {
    await run(["schedule", "add", "alice", "--id", "test", "--every", "5m", "--prompt", "Hello"]);
    expect(casaScheduleAdd).toHaveBeenCalledWith(
      deps.processManager,
      "alice",
      { id: "test", every: "5m", prompt: "Hello" },
    );
    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining("test"),
    );
  });

  it("schedule list calls casaScheduleList", async () => {
    (casaScheduleList as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "x",
        trigger: { type: "interval", every: "5m", intervalMs: 300_000 },
        prompt: "A very long prompt that exceeds fifty characters to test the truncation logic properly",
        paused: true,
      },
      {
        id: "y",
        trigger: { type: "interval", every: "1h", intervalMs: 3_600_000 },
        prompt: "short",
      },
    ]);
    await run(["schedule", "list", "alice"]);
    expect(casaScheduleList).toHaveBeenCalledWith(deps.processManager, "alice");
    const tableCall = (deps.formatter.table as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(tableCall[0]).toEqual(expect.arrayContaining(["ID"]));
    const rows = tableCall[1] as string[][];
    expect(rows[0]![2]).toContain("...");
    expect(rows[0]![3]).toBe("yes");
    expect(rows[1]![3]).toBe("no");
  });

  it("schedule list shows info when empty", async () => {
    (casaScheduleList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await run(["schedule", "list", "alice"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No schedules configured");
  });

  it("schedule remove calls casaScheduleRemove", async () => {
    await run(["schedule", "remove", "alice", "test-sched"]);
    expect(casaScheduleRemove).toHaveBeenCalledWith(deps.processManager, "alice", "test-sched");
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("test-sched"));
  });

  it("schedule pause calls casaSchedulePause", async () => {
    await run(["schedule", "pause", "alice", "test-sched"]);
    expect(casaSchedulePause).toHaveBeenCalledWith(deps.processManager, "alice", "test-sched");
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("test-sched"));
  });

  it("schedule pause all calls casaSchedulePause without id", async () => {
    await run(["schedule", "pause", "alice"]);
    expect(casaSchedulePause).toHaveBeenCalledWith(deps.processManager, "alice", undefined);
  });

  it("schedule resume calls casaScheduleResume", async () => {
    await run(["schedule", "resume", "alice", "test-sched"]);
    expect(casaScheduleResume).toHaveBeenCalledWith(deps.processManager, "alice", "test-sched");
  });

  it("schedule resume all calls casaScheduleResume without id", async () => {
    await run(["schedule", "resume", "alice"]);
    expect(casaScheduleResume).toHaveBeenCalledWith(deps.processManager, "alice", undefined);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("all schedules"));
  });

  it("schedule run calls casaScheduleRun", async () => {
    await run(["schedule", "run", "alice", "test-sched"]);
    expect(casaScheduleRun).toHaveBeenCalledWith(deps.processManager, "alice", "test-sched");
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("100ms"));
  });

  it("schedule run shows error for failed outcome", async () => {
    (casaScheduleRun as ReturnType<typeof vi.fn>).mockResolvedValue({
      outcome: "error",
      error: "API down",
      durationMs: 50,
    });
    await run(["schedule", "run", "alice", "test-sched"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("API down"));
  });

  it("schedule run shows warning for skipped outcome", async () => {
    (casaScheduleRun as ReturnType<typeof vi.fn>).mockResolvedValue({
      outcome: "skipped",
      error: "Budget exceeded",
      durationMs: 0,
    });
    await run(["schedule", "run", "alice", "test-sched"]);
    expect(deps.formatter.warn).toHaveBeenCalledWith(expect.stringContaining("Budget exceeded"));
  });

  it("schedule history calls casaScheduleHistory", async () => {
    (casaScheduleHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { scheduleId: "s", startedAt: "now", completedAt: "later", durationMs: 100, outcome: "success" },
    ]);
    await run(["schedule", "history", "alice", "test-sched"]);
    expect(casaScheduleHistory).toHaveBeenCalledWith(deps.processManager, "alice", "test-sched", 20);
    const tableCall = (deps.formatter.table as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(tableCall[0]).toEqual(expect.arrayContaining(["Outcome"]));
    const rows = tableCall[1] as string[][];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.arrayContaining(["success"]));
  });

  it("schedule history shows info when empty", async () => {
    await run(["schedule", "history", "alice", "test-sched"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No run history");
  });

  it("schedule history respects --limit", async () => {
    await run(["schedule", "history", "alice", "test-sched", "--limit", "5"]);
    expect(casaScheduleHistory).toHaveBeenCalledWith(deps.processManager, "alice", "test-sched", 5);
  });

  it("schedule history rejects invalid --limit", async () => {
    await run(["schedule", "history", "alice", "test-sched", "--limit", "abc"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid limit"),
    );
    expect(casaScheduleHistory).not.toHaveBeenCalled();
  });

  it("schedule history rejects zero --limit", async () => {
    await run(["schedule", "history", "alice", "test-sched", "--limit", "0"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid limit"),
    );
  });

  it("schedule history rejects negative --limit", async () => {
    await run(["schedule", "history", "alice", "test-sched", "--limit", "-3"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid limit"),
    );
  });
});
