import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

describe("bot remove command", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); });

  it("stops running bot and deletes directory", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-bot-remove-"));
    const botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "remove", "alice"]);
    expect(deps.processManager.stop).toHaveBeenCalledWith("alice");
    expect(existsSync(botDir)).toBe(false);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Removed"));
  });

  it("uses kill with --force", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-bot-remove-"));
    const botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "remove", "alice", "--force"]);
    expect(deps.processManager.kill).toHaveBeenCalledWith("alice");
    expect(deps.processManager.stop).not.toHaveBeenCalled();
    expect(existsSync(botDir)).toBe(false);
  });

  it("deletes without stopping when bot is already stopped", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-bot-remove-"));
    const botDir = join(mechaDir, "alice");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const deps = makeDeps({
      mechaDir,
      pm: { ...defaultPm(), get: vi.fn().mockReturnValue({ ...RUNNING_INFO, state: "stopped" }) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "remove", "alice"]);
    expect(deps.processManager.stop).not.toHaveBeenCalled();
    expect(existsSync(botDir)).toBe(false);
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Removed"));
  });

  it("errors if bot directory does not exist", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-bot-remove-"));

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "remove", "ghost"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(process.exitCode).toBe(1);
  });
});
