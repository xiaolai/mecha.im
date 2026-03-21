import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProgram } from "../src/program.js";
import { makeDeps } from "./test-utils.js";
import type { CommandDeps } from "../src/types.js";

// Mock the service layer
vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    botScheduleAdd: vi.fn(),
    botScheduleRemove: vi.fn(),
    botScheduleList: vi.fn().mockResolvedValue([]),
    botSchedulePause: vi.fn(),
    botScheduleResume: vi.fn(),
    botScheduleRun: vi.fn().mockResolvedValue({
      scheduleId: "test",
      startedAt: "2026-02-25T10:00:00Z",
      completedAt: "2026-02-25T10:00:01Z",
      durationMs: 100,
      outcome: "success",
    }),
    botScheduleHistory: vi.fn().mockResolvedValue([]),
  };
});

import {
  botScheduleAdd,
  botScheduleList,
  botScheduleRemove,
  botSchedulePause,
  botScheduleResume,
  botScheduleRun,
  botScheduleHistory,
} from "@mecha/service";

describe("schedule commands", () => {
  let deps: CommandDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply default mock return values after clearAllMocks
    (botScheduleList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (botScheduleRun as ReturnType<typeof vi.fn>).mockResolvedValue({
      scheduleId: "test",
      startedAt: "2026-02-25T10:00:00Z",
      completedAt: "2026-02-25T10:00:01Z",
      durationMs: 100,
      outcome: "success",
    });
    (botScheduleHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);
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

  it("schedule add calls botScheduleAdd", async () => {
    await run(["schedule", "add", "alice", "--id", "test", "--every", "5m", "--prompt", "Hello"]);
    expect(botScheduleAdd).toHaveBeenCalledWith(
      deps.processManager,
      "alice",
      { id: "test", every: "5m", prompt: "Hello" },
    );
    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining("test"),
    );
  });

  it("schedule list calls botScheduleList", async () => {
    (botScheduleList as ReturnType<typeof vi.fn>).mockResolvedValue([
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
    expect(botScheduleList).toHaveBeenCalledWith(deps.processManager, "alice");
    const tableCall = (deps.formatter.table as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(tableCall[0]).toEqual(expect.arrayContaining(["ID"]));
    const rows = tableCall[1] as string[][];
    expect(rows[0]![2]).toContain("...");
    expect(rows[0]![3]).toBe("yes");
    expect(rows[1]![3]).toBe("no");
  });

  it("schedule list shows info when empty", async () => {
    (botScheduleList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await run(["schedule", "list", "alice"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No schedules configured");
  });

  it("schedule remove calls botScheduleRemove", async () => {
    await run(["schedule", "remove", "alice", "test-sched"]);
    expect(botScheduleRemove).toHaveBeenCalledWith(deps.processManager, "alice", "test-sched");
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("test-sched"));
  });

  it("schedule pause calls botSchedulePause", async () => {
    await run(["schedule", "pause", "alice", "test-sched"]);
    expect(botSchedulePause).toHaveBeenCalledWith(deps.processManager, "alice", "test-sched");
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("test-sched"));
  });

  it("schedule pause all calls botSchedulePause without id", async () => {
    await run(["schedule", "pause", "alice"]);
    expect(botSchedulePause).toHaveBeenCalledWith(deps.processManager, "alice", undefined);
  });

  it("schedule resume calls botScheduleResume", async () => {
    await run(["schedule", "resume", "alice", "test-sched"]);
    expect(botScheduleResume).toHaveBeenCalledWith(deps.processManager, "alice", "test-sched");
  });

  it("schedule resume all calls botScheduleResume without id", async () => {
    await run(["schedule", "resume", "alice"]);
    expect(botScheduleResume).toHaveBeenCalledWith(deps.processManager, "alice", undefined);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("all schedules"));
  });

  it("schedule run calls botScheduleRun", async () => {
    await run(["schedule", "run", "alice", "test-sched"]);
    expect(botScheduleRun).toHaveBeenCalledWith(deps.processManager, "alice", "test-sched");
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("100ms"));
  });

  it("schedule run shows error for failed outcome", async () => {
    (botScheduleRun as ReturnType<typeof vi.fn>).mockResolvedValue({
      outcome: "error",
      error: "API down",
      durationMs: 50,
    });
    await run(["schedule", "run", "alice", "test-sched"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("API down"));
  });

  it("schedule run shows warning for skipped outcome", async () => {
    (botScheduleRun as ReturnType<typeof vi.fn>).mockResolvedValue({
      outcome: "skipped",
      error: "Budget exceeded",
      durationMs: 0,
    });
    await run(["schedule", "run", "alice", "test-sched"]);
    expect(deps.formatter.warn).toHaveBeenCalledWith(expect.stringContaining("Budget exceeded"));
  });

  it("schedule history calls botScheduleHistory", async () => {
    (botScheduleHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { scheduleId: "s", startedAt: "now", completedAt: "later", durationMs: 100, outcome: "success" },
    ]);
    await run(["schedule", "history", "alice", "test-sched"]);
    expect(botScheduleHistory).toHaveBeenCalledWith(deps.processManager, "alice", "test-sched", 20);
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
    expect(botScheduleHistory).toHaveBeenCalledWith(deps.processManager, "alice", "test-sched", 5);
  });

  it("schedule history rejects invalid --limit", async () => {
    await run(["schedule", "history", "alice", "test-sched", "--limit", "abc"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid limit"),
    );
    expect(botScheduleHistory).not.toHaveBeenCalled();
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
