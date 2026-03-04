import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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
    get: vi.fn().mockReturnValue(undefined),
    list: vi.fn().mockReturnValue([]),
    stop: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
  };
}

describe("bot start command", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); });

  function writeConfig(name: string, config: Record<string, unknown>): void {
    const dir = join(mechaDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  }

  it("starts a stopped bot from config", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-bot-start-"));
    writeConfig("alice", { port: 7700, token: "t", workspace: "/workspace", tags: ["dev"], model: "claude-sonnet-4-5-20250514" });

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "start", "alice"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "alice",
        workspacePath: "/workspace",
        tags: ["dev"],
        model: "claude-sonnet-4-5-20250514",
      }),
    );
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Started"));
  });

  it("errors if config is missing", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-bot-start-"));

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "start", "ghost"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(process.exitCode).toBe(1);
  });

  it("errors if bot is already running", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-bot-start-"));
    writeConfig("alice", { port: 7700, token: "t", workspace: "/workspace" });

    const deps = makeDeps({
      mechaDir,
      pm: { ...defaultPm(), get: vi.fn().mockReturnValue({ ...RUNNING_INFO, state: "running" }) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "start", "alice"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("already running"));
    expect(process.exitCode).toBe(1);
    expect(deps.processManager.spawn).not.toHaveBeenCalled();
  });

  it("forwards config fields to spawn", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-bot-start-"));
    writeConfig("alice", {
      port: 7700, token: "t", workspace: "/ws",
      auth: "personal", expose: ["query"], sandboxMode: "require", permissionMode: "full-auto",
    });

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "start", "alice"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: "personal",
        expose: ["query"],
        sandboxMode: "require",
        permissionMode: "full-auto",
      }),
    );
  });
});
