import { describe, it, expect, vi, afterEach } from "vitest";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { ProcessManager, ProcessInfo } from "@mecha/process";
import type { BotName } from "@mecha/core";

afterEach(() => { process.exitCode = undefined as unknown as number; });

vi.mock("@mecha/meter", () => ({
  stopDaemon: vi.fn().mockReturnValue(false),
  meterDir: vi.fn().mockReturnValue("/tmp/mecha/meter"),
}));

const RUNNING_INFO: ProcessInfo = {
  name: "alice" as BotName,
  state: "running",
  pid: 12345,
  port: 7700,
  workspacePath: "/workspace",
  token: "tok",
  startedAt: "2026-01-01T00:00:00Z",
};

function defaultPm(): Partial<ProcessManager> {
  return {
    spawn: vi.fn().mockResolvedValue(RUNNING_INFO),
    get: vi.fn().mockReturnValue(RUNNING_INFO),
    list: vi.fn().mockReturnValue([]),
    stop: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
  };
}

describe("stop command (daemon)", () => {
  it("stops all running bots", async () => {
    const bob: ProcessInfo = { ...RUNNING_INFO, name: "bob" as BotName, port: 7701 };
    const deps = makeDeps({
      pm: {
        ...defaultPm(),
        list: vi.fn().mockReturnValue([RUNNING_INFO, bob]),
      },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "stop"]);
    expect(deps.processManager.stop).toHaveBeenCalledWith("alice");
    expect(deps.processManager.stop).toHaveBeenCalledWith("bob");
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Stopped alice"));
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Stopped bob"));
    expect(deps.formatter.success).toHaveBeenCalledWith("Daemon stopped");
  });

  it("force kills with --force", async () => {
    const deps = makeDeps({
      pm: {
        ...defaultPm(),
        list: vi.fn().mockReturnValue([RUNNING_INFO]),
      },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "stop", "--force"]);
    expect(deps.processManager.kill).toHaveBeenCalledWith("alice");
    expect(deps.processManager.stop).not.toHaveBeenCalled();
  });

  it("succeeds with no running bots", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "stop"]);
    expect(deps.processManager.stop).not.toHaveBeenCalled();
    expect(deps.formatter.success).toHaveBeenCalledWith("Daemon stopped");
  });

  it("reports partial failures", async () => {
    const deps = makeDeps({
      pm: {
        ...defaultPm(),
        list: vi.fn().mockReturnValue([RUNNING_INFO]),
        stop: vi.fn().mockRejectedValue(new Error("timeout")),
      },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "stop"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Failed to stop alice"));
    expect(process.exitCode).toBe(1);
  });

  it("stops meter if running", async () => {
    const { stopDaemon } = await import("@mecha/meter");
    vi.mocked(stopDaemon).mockReturnValue(true);

    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "stop"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("Metering proxy stopped");
  });
});
