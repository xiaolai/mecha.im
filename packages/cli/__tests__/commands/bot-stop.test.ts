import { describe, it, expect, vi, afterEach } from "vitest";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { ProcessManager, ProcessInfo } from "@mecha/process";
import type { BotName } from "@mecha/core";

vi.mock("@mecha/service", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@mecha/service")>();
  return { ...orig, checkBotBusy: vi.fn().mockResolvedValue({ busy: false, activeSessions: 0 }) };
});

import { checkBotBusy } from "@mecha/service";
const mockCheckBusy = vi.mocked(checkBotBusy);

afterEach(() => {
  process.exitCode = undefined as unknown as number;
  mockCheckBusy.mockResolvedValue({ busy: false, activeSessions: 0 });
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
    list: vi.fn().mockReturnValue([RUNNING_INFO]),
    stop: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
  };
}

describe("bot stop command", () => {
  it("stops a non-busy bot", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "stop", "alice"]);
    expect(deps.processManager.stop).toHaveBeenCalledWith("alice");
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Stopped"));
  });

  it("errors when bot is busy and --force not set", async () => {
    mockCheckBusy.mockResolvedValue({ busy: true, activeSessions: 2, lastActivity: "2026-01-01T00:00:00Z" });
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "stop", "alice"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("active session"));
    expect(process.exitCode).toBe(1);
    expect(deps.processManager.stop).not.toHaveBeenCalled();
  });

  it("stops busy bot with --force", async () => {
    mockCheckBusy.mockResolvedValue({ busy: true, activeSessions: 2 });
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "stop", "alice", "--force"]);
    expect(deps.processManager.stop).toHaveBeenCalledWith("alice");
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Stopped"));
  });
});
