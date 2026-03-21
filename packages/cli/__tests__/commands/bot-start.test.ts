import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { ProcessManager, ProcessInfo } from "@mecha/process";
import type { BotName } from "@mecha/core";

vi.mock("@mecha/process", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@mecha/process")>();
  return { ...orig, checkPort: vi.fn().mockResolvedValue(true) };
});

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
      auth: "personal", expose: ["query"], sandboxMode: "require", permissionMode: "bypassPermissions",
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
        permissionMode: "bypassPermissions",
      }),
    );
  });

  it("forwards ALL config fields to spawn (11.2 full config parity)", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-bot-start-"));
    const fullConfig = {
      port: 7700, token: "t", workspace: "/ws",
      home: "/home/bot",
      auth: "work-profile",
      tags: ["prod", "gpu"],
      expose: ["query", "read_workspace"],
      sandboxMode: "require",
      model: "claude-sonnet-4-5-20250514",
      permissionMode: "bypassPermissions",
      systemPrompt: "You are a coding assistant.",
      appendSystemPrompt: "Always be concise.",
      effort: "high",
      maxBudgetUsd: 5.50,
      allowedTools: ["Read", "Write"],
      disallowedTools: ["Bash"],
      tools: undefined, // mutually exclusive with allowedTools
      agent: "coder",
      agents: { helper: { description: "A helper", prompt: "Help users." } },
      sessionPersistence: false,
      budgetLimit: 25,
      mcpServers: { fs: { command: "node" } },
      mcpConfigFiles: ["/mcp.json"],
      strictMcpConfig: true,
      disableSlashCommands: true,
      addDirs: ["/extra"],
      env: { NODE_ENV: "production" },
      fallbackModel: "claude-haiku-4-5-20251001",
      dangerouslySkipPermissions: true,
      allowDangerouslySkipPermissions: true,
    };

    writeConfig("alice", fullConfig);

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "start", "alice"]);

    const spawnCall = vi.mocked(deps.processManager.spawn).mock.calls[0]![0]!;

    // Verify every config field is forwarded (not just a subset)
    expect(spawnCall.name).toBe("alice");
    expect(spawnCall.workspacePath).toBe("/ws");
    expect(spawnCall.home).toBe("/home/bot");
    expect(spawnCall.port).toBe(7700);
    expect(spawnCall.auth).toBe("work-profile");
    expect(spawnCall.tags).toEqual(["prod", "gpu"]);
    expect(spawnCall.expose).toEqual(["query", "read_workspace"]);
    expect(spawnCall.sandboxMode).toBe("require");
    expect(spawnCall.model).toBe("claude-sonnet-4-5-20250514");
    expect(spawnCall.permissionMode).toBe("bypassPermissions");
    expect(spawnCall.systemPrompt).toBe("You are a coding assistant.");
    expect(spawnCall.appendSystemPrompt).toBe("Always be concise.");
    expect(spawnCall.effort).toBe("high");
    expect(spawnCall.maxBudgetUsd).toBe(5.50);
    expect(spawnCall.allowedTools).toEqual(["Read", "Write"]);
    expect(spawnCall.disallowedTools).toEqual(["Bash"]);
    expect(spawnCall.agent).toBe("coder");
    expect(spawnCall.agents).toEqual({ helper: { description: "A helper", prompt: "Help users." } });
    expect(spawnCall.sessionPersistence).toBe(false);
    expect(spawnCall.budgetLimit).toBe(25);
    expect(spawnCall.mcpServers).toEqual({ fs: { command: "node" } });
    expect(spawnCall.mcpConfigFiles).toEqual(["/mcp.json"]);
    expect(spawnCall.strictMcpConfig).toBe(true);
    expect(spawnCall.disableSlashCommands).toBe(true);
    expect(spawnCall.addDirs).toEqual(["/extra"]);
    expect(spawnCall.env).toEqual({ NODE_ENV: "production" });
    expect(spawnCall.fallbackModel).toBe("claude-haiku-4-5-20251001");
    expect(spawnCall.dangerouslySkipPermissions).toBe(true);
    expect(spawnCall.allowDangerouslySkipPermissions).toBe(true);
  });
});
