import { describe, it, expect, vi, afterEach } from "vitest";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { ProcessManager, ProcessInfo } from "@mecha/process";
import type { BotName } from "@mecha/core";

afterEach(() => { process.exitCode = undefined as unknown as number; });

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
    list: vi.fn().mockReturnValue([RUNNING_INFO]),
    stop: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
  };
}

describe("bot kill command", () => {
  it("kills a single bot", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "kill", "alice"]);
    expect(deps.processManager.kill).toHaveBeenCalledWith("alice");
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Killed"));
  });

  it("kills multiple bots", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "kill", "alice", "bob"]);
    expect(deps.processManager.kill).toHaveBeenCalledWith("alice");
    expect(deps.processManager.kill).toHaveBeenCalledWith("bob");
    expect(deps.formatter.success).toHaveBeenCalledTimes(2);
  });
});
