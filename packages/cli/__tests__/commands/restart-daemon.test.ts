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

vi.mock("@mecha/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/core")>();
  return {
    ...actual,
    readBotConfig: vi.fn().mockReturnValue({
      port: 7700, token: "tok", workspace: "/workspace",
      tags: [], expose: false, sandboxMode: "relaxed",
      model: "sonnet", permissionMode: "default",
    }),
  };
});

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

describe("restart command (daemon)", () => {
  it("stops running bots then reports restart", async () => {
    const deps = makeDeps({
      pm: {
        ...defaultPm(),
        list: vi.fn().mockReturnValue([RUNNING_INFO]),
      },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "restart"]);
    expect(deps.processManager.stop).toHaveBeenCalledWith("alice");
    expect(deps.formatter.success).toHaveBeenCalledWith("Daemon stopped");
  });

  it("uses kill with --force", async () => {
    const deps = makeDeps({
      pm: {
        ...defaultPm(),
        list: vi.fn().mockReturnValue([RUNNING_INFO]),
      },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "restart", "--force"]);
    expect(deps.processManager.kill).toHaveBeenCalledWith("alice");
    expect(deps.processManager.stop).not.toHaveBeenCalled();
  });

  it("succeeds with no running bots", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "restart"]);
    expect(deps.formatter.success).toHaveBeenCalledWith("Daemon stopped");
  });

  it("collects and respawns bots with --restart-bots", async () => {
    const deps = makeDeps({
      pm: {
        ...defaultPm(),
        list: vi.fn().mockReturnValue([RUNNING_INFO]),
      },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "restart", "--restart-bots"]);
    expect(deps.processManager.stop).toHaveBeenCalledWith("alice");
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ name: "alice", workspacePath: "/workspace" }),
    );
    expect(deps.formatter.success).toHaveBeenCalledWith("Restarted alice on port 7700");
  });
});
