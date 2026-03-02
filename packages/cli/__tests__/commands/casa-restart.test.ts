import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { ProcessManager, ProcessInfo } from "@mecha/process";
import type { CasaName } from "@mecha/core";

vi.mock("@mecha/service", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@mecha/service")>();
  return { ...orig, checkCasaBusy: vi.fn().mockResolvedValue({ busy: false, activeSessions: 0 }) };
});

import { checkCasaBusy } from "@mecha/service";
const mockCheckBusy = vi.mocked(checkCasaBusy);

afterEach(() => {
  process.exitCode = undefined as unknown as number;
  mockCheckBusy.mockClear();
  mockCheckBusy.mockResolvedValue({ busy: false, activeSessions: 0 });
});

const RUNNING_INFO: ProcessInfo = {
  name: "alice" as CasaName,
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

describe("casa restart command", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); });

  function writeConfig(name: string, config: Record<string, unknown>): void {
    const dir = join(mechaDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  }

  it("stops running CASA then respawns from config", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-casa-restart-"));
    writeConfig("alice", { port: 7700, token: "t", workspace: "/workspace" });

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "restart", "alice"]);
    expect(deps.processManager.stop).toHaveBeenCalledWith("alice");
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ name: "alice", workspacePath: "/workspace" }),
    );
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Restarted"));
  });

  it("uses kill with --force", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-casa-restart-"));
    writeConfig("alice", { port: 7700, token: "t", workspace: "/workspace" });

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "restart", "alice", "--force"]);
    expect(deps.processManager.kill).toHaveBeenCalledWith("alice");
    expect(deps.processManager.stop).not.toHaveBeenCalled();
    expect(deps.processManager.spawn).toHaveBeenCalled();
  });

  it("just spawns when CASA is stopped", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-casa-restart-"));
    writeConfig("alice", { port: 7700, token: "t", workspace: "/workspace" });

    const deps = makeDeps({
      mechaDir,
      pm: { ...defaultPm(), get: vi.fn().mockReturnValue({ ...RUNNING_INFO, state: "stopped" }) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "restart", "alice"]);
    expect(deps.processManager.stop).not.toHaveBeenCalled();
    expect(deps.processManager.kill).not.toHaveBeenCalled();
    expect(deps.processManager.spawn).toHaveBeenCalled();
  });

  it("errors if config is missing", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-casa-restart-"));

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "restart", "ghost"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(process.exitCode).toBe(1);
    expect(deps.processManager.stop).not.toHaveBeenCalled();
    expect(deps.processManager.spawn).not.toHaveBeenCalled();
  });

  it("errors when busy and --force not set", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-casa-restart-"));
    writeConfig("alice", { port: 7700, token: "t", workspace: "/workspace" });
    mockCheckBusy.mockResolvedValue({ busy: true, activeSessions: 3 });

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "restart", "alice"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("active session"));
    expect(process.exitCode).toBe(1);
    expect(deps.processManager.stop).not.toHaveBeenCalled();
    expect(deps.processManager.spawn).not.toHaveBeenCalled();
  });

  it("restarts busy CASA with --force (skips task check)", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-casa-restart-"));
    writeConfig("alice", { port: 7700, token: "t", workspace: "/workspace" });
    mockCheckBusy.mockResolvedValue({ busy: true, activeSessions: 3 });

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "casa", "restart", "alice", "--force"]);
    expect(mockCheckBusy).not.toHaveBeenCalled();
    expect(deps.processManager.kill).toHaveBeenCalledWith("alice");
    expect(deps.processManager.spawn).toHaveBeenCalled();
  });
});
