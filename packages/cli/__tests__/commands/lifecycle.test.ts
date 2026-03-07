import { describe, it, expect, vi, afterEach } from "vitest";
import { Readable } from "node:stream";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { ProcessManager, ProcessInfo } from "@mecha/process";
import type { BotName } from "@mecha/core";

afterEach(() => { process.exitCode = undefined as unknown as number; });

const RUNNING_INFO: ProcessInfo = {
  name: "test" as BotName,
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
    logs: vi.fn().mockReturnValue(new Readable({ read() { this.push(null); } })),
    getPortAndToken: vi.fn().mockReturnValue({ port: 7700, token: "tok" }),
  };
}

describe("bot spawn command", () => {
  it("spawns a bot", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "spawn", "researcher", tmpdir()]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ name: "researcher", workspacePath: tmpdir() }),
    );
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Spawned"));
  });

  it("spawns with port option", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "spawn", "test", tmpdir(), "--port", "7701"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ port: 7701 }),
    );
  });

  it("rejects invalid port value", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "spawn", "test", tmpdir(), "--port", "abc"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Port must be"));
    expect(process.exitCode).toBe(1);

  });

  it("spawns with tags option", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "spawn", "test", tmpdir(), "--tags", "dev,research, ml"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["dev", "research", "ml"] }),
    );
  });

  it("rejects invalid tags", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "spawn", "test", tmpdir(), "--tags", "has space,ok"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("invalid characters"));
    expect(process.exitCode).toBe(1);

  });

  it("spawns with auth option", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "spawn", "test", tmpdir(), "--auth", "personal"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ auth: "personal" }),
    );
  });

  it("spawns with --no-auth (null auth)", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "spawn", "test", tmpdir(), "--no-auth"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ auth: null }),
    );
  });

  it("spawns with expose option", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "spawn", "test", tmpdir(), "--expose", "query,read_workspace"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ expose: ["query", "read_workspace"] }),
    );
  });

  it("rejects invalid expose capability", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "spawn", "test", tmpdir(), "--expose", "bogus"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid capability"));
    expect(process.exitCode).toBe(1);

  });

  it("spawns with model option", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "spawn", "test", tmpdir(), "--model", "claude-sonnet-4-5-20250514"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-4-5-20250514" }),
    );
  });

  it("spawns with permission-mode option", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "spawn", "test", tmpdir(), "--permission-mode", "full-auto"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: "full-auto" }),
    );
  });

  it("rejects invalid permission mode", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "spawn", "test", tmpdir(), "--permission-mode", "bogus"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Permission mode must be"));
    expect(process.exitCode).toBe(1);
    expect(deps.processManager.spawn).not.toHaveBeenCalled();
  });

  it("spawns with sandbox mode option", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "spawn", "test", tmpdir(), "--sandbox", "require"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxMode: "require" }),
    );
  });

  it("rejects invalid sandbox mode", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "spawn", "test", tmpdir(), "--sandbox", "bogus"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Sandbox mode must be"));
    expect(process.exitCode).toBe(1);

  });

  it("rejects non-existent workspace path", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "spawn", "test", "/nonexistent/path/xyz"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Path not found"));
    expect(deps.processManager.spawn).not.toHaveBeenCalled();
  });

  it("rejects workspace path that is not a directory", async () => {
    const tempFile = join(mkdtempSync(join(tmpdir(), "spawn-test-")), "file.txt");
    writeFileSync(tempFile, "not a directory");
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "spawn", "test", tempFile]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("not a directory"));
    expect(deps.processManager.spawn).not.toHaveBeenCalled();
    rmSync(join(tempFile, ".."), { recursive: true, force: true });
  });

  it("passes new config options through to spawn", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync([
      "node", "mecha", "bot", "spawn", "test", tmpdir(),
      "--system-prompt", "You are a coding assistant",
      "--effort", "high",
      "--max-budget-usd", "5.50",
      "--allowed-tools", "Read,Write,Bash",
      "--disallowed-tools", "WebFetch",
      "--add-dir", "/extra,/more",
      "--agent", "coder",
      "--mcp-config", "/a.json,/b.json",
      "--strict-mcp-config",
      "--plugin-dir", "/plugins",
      "--disable-slash-commands",
      "--budget-limit", "100",
    ]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: "You are a coding assistant",
        effort: "high",
        maxBudgetUsd: 5.50,
        allowedTools: ["Read", "Write", "Bash"],
        disallowedTools: ["WebFetch"],
        addDirs: ["/extra", "/more"],
        agent: "coder",
        mcpConfigFiles: ["/a.json", "/b.json"],
        strictMcpConfig: true,
        pluginDirs: ["/plugins"],
        disableSlashCommands: true,
        budgetLimit: 100,
      }),
    );
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Spawned"));
  });

  it("rejects conflicting system prompts", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync([
      "node", "mecha", "bot", "spawn", "test", tmpdir(),
      "--system-prompt", "override",
      "--append-system-prompt", "extra",
    ]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("mutually exclusive"));
    expect(process.exitCode).toBe(1);
    expect(deps.processManager.spawn).not.toHaveBeenCalled();
  });

  it("rejects invalid effort level", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync([
      "node", "mecha", "bot", "spawn", "test", tmpdir(),
      "--effort", "ultra",
    ]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Effort must be"));
    expect(process.exitCode).toBe(1);
    expect(deps.processManager.spawn).not.toHaveBeenCalled();
  });

  it("shows validation warnings", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync([
      "node", "mecha", "bot", "spawn", "test", tmpdir(),
      "--max-budget-usd", "10",
      "--meter", "off",
    ]);
    expect(deps.formatter.warn).toHaveBeenCalledWith(expect.stringContaining("metering is off"));
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Spawned"));
  });

  it("passes sessionPersistence false with --no-session-persistence", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync([
      "node", "mecha", "bot", "spawn", "test", tmpdir(),
      "--no-session-persistence",
    ]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionPersistence: false }),
    );
  });

  it("omits sessionPersistence when flag is not used", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "spawn", "test", tmpdir()]);
    const spawnArg = (deps.processManager.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(spawnArg).not.toHaveProperty("sessionPersistence");
  });

  it("subscribes to warning events during spawn", async () => {
    const onEventMock = vi.fn().mockReturnValue(() => {});
    const deps = makeDeps({ pm: { ...defaultPm(), onEvent: onEventMock } });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "spawn", "test", tmpdir()]);
    expect(onEventMock).toHaveBeenCalledWith(expect.any(Function));
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Spawned"));
  });
});

describe("bot kill command", () => {
  it("kills a bot", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "kill", "researcher"]);
    expect(deps.processManager.kill).toHaveBeenCalledWith("researcher");
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Killed"));
  });
});

describe("bot stop command", () => {
  it("stops a bot", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "stop", "researcher"]);
    expect(deps.processManager.stop).toHaveBeenCalledWith("researcher");
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Stopped"));
  });

  it("handles error for unknown bot", async () => {
    const { BotNotFoundError } = await import("@mecha/core");
    const deps = makeDeps({
      pm: { ...defaultPm(), stop: vi.fn().mockRejectedValue(new BotNotFoundError("ghost")) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "stop", "ghost"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(process.exitCode).toBe(1);
  });

  it("handles error for already-stopped bot", async () => {
    const { BotNotRunningError } = await import("@mecha/core");
    const deps = makeDeps({
      pm: { ...defaultPm(), stop: vi.fn().mockRejectedValue(new BotNotRunningError("test")) },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "stop", "test"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("not running"));
    expect(process.exitCode).toBe(1);
  });
});

describe("bot ls command", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); });

  function writeBotConfig(name: string, tags: string[]): void {
    const dir = join(mechaDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: tmpdir(), tags }));
  }

  it("lists bots with tags", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-ls-"));
    writeBotConfig("test", ["code", "dev"]);
    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "ls"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Name", "State", "Port", "PID", "Tags"],
      [["test", "running", "7700", "12345", "code, dev"]],
    );
  });

  it("shows message when no bots", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-ls-"));
    const deps = makeDeps({ mechaDir, pm: { ...defaultPm(), list: vi.fn().mockReturnValue([]) } });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "ls"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No bots running");
  });

  it("shows dash for undefined port/pid and empty tags", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-ls-"));
    const dir = join(mechaDir, "x");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: tmpdir() }));

    const deps = makeDeps({
      mechaDir,
      pm: {
        ...defaultPm(),
        list: vi.fn().mockReturnValue([
          { name: "x", state: "stopped", port: undefined, pid: undefined, workspacePath: tmpdir() },
        ]),
      },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "ls"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Name", "State", "Port", "PID", "Tags"],
      [["x", "stopped", "-", "-", "-"]],
    );
  });

  it("displays tree indentation based on workspace nesting", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-ls-"));
    const parentDir = join(mechaDir, "parent");
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(join(parentDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/project", tags: [] }));

    const childDir = join(mechaDir, "child");
    mkdirSync(childDir, { recursive: true });
    writeFileSync(join(childDir, "config.json"), JSON.stringify({ port: 7701, token: "t", workspace: "/project/sub", tags: [] }));

    const parentInfo: ProcessInfo = {
      name: "parent" as BotName,
      state: "running",
      pid: 1000,
      port: 7700,
      workspacePath: "/project",
    };
    const childInfo: ProcessInfo = {
      name: "child" as BotName,
      state: "running",
      pid: 1001,
      port: 7701,
      workspacePath: "/project/sub",
    };

    const deps = makeDeps({
      mechaDir,
      pm: {
        ...defaultPm(),
        list: vi.fn().mockReturnValue([parentInfo, childInfo]),
      },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "ls"]);
    const tableCall = (deps.formatter.table as ReturnType<typeof vi.fn>).mock.calls[0];
    const rows = tableCall[1] as string[][];
    // Parent at depth 0 — no indent
    expect(rows[0][0]).toBe("parent");
    // Child at depth 1 — indented
    expect(rows[1][0]).toBe("  child");
  });
});

describe("bot status command", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); });

  it("shows bot status without token", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "status", "test"]);
    const tableCall = (deps.formatter.table as ReturnType<typeof vi.fn>).mock.calls[0];
    const rows = tableCall[1] as string[][];
    expect(tableCall[0]).toEqual(["Field", "Value"]);
    // token must not appear in key-value pairs
    expect(rows.find(([k]) => k === "token")).toBeUndefined();
    expect(rows.find(([k]) => k === "name")?.[1]).toBe("test");
    expect(rows.find(([k]) => k === "state")?.[1]).toBe("running");
  });

  it("outputs JSON object in json mode", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    deps.formatter.isJson = true;
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "status", "test"]);
    const jsonArg = (deps.formatter.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonArg.name).toBe("test");
    expect(jsonArg).not.toHaveProperty("token");
  });

  function getStatusRows(deps: ReturnType<typeof makeDeps>): string[][] {
    return (deps.formatter.table as ReturnType<typeof vi.fn>).mock.calls[0][1];
  }
  function findRow(rows: string[][], key: string): string | undefined {
    return rows.find(([k]) => k === key)?.[1];
  }

  it("includes fingerprint when identity exists", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-status-"));
    const botDir = join(mechaDir, "test");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "identity.json"), JSON.stringify({
      name: "test",
      nodeId: "node-123",
      publicKey: "pk",
      nodePublicKey: "npk",
      fingerprint: "sha256:abcdef",
      signature: "sig",
      createdAt: "2026-01-01T00:00:00Z",
    }));

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "status", "test"]);
    expect(findRow(getStatusRows(deps), "fingerprint")).toBe("sha256:abcdef");
  });

  it("includes expose when config has it", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-status-"));
    const botDir = join(mechaDir, "test");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "config.json"), JSON.stringify({
      port: 7700, token: "t", workspace: tmpdir(), expose: ["query", "read_workspace"],
    }));

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "status", "test"]);
    expect(findRow(getStatusRows(deps), "expose")).toBe("query, read_workspace");
  });

  it("includes parent when workspace is nested", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-status-"));
    const parentInfo: ProcessInfo = {
      name: "parent" as BotName,
      state: "running",
      pid: 1000,
      port: 7700,
      workspacePath: "/project",
    };
    const childInfo: ProcessInfo = {
      ...RUNNING_INFO,
      name: "child" as BotName,
      workspacePath: "/project/sub",
    };

    const deps = makeDeps({
      mechaDir,
      pm: {
        ...defaultPm(),
        get: vi.fn().mockReturnValue(childInfo),
        list: vi.fn().mockReturnValue([parentInfo, childInfo]),
      },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "status", "child"]);
    expect(findRow(getStatusRows(deps), "parent")).toBe("parent");
  });

  it("omits parent when workspace is not nested", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "status", "test"]);
    const rows = getStatusRows(deps);
    expect(rows.find(([k]) => k === "parent")).toBeUndefined();
  });

  it("omits fingerprint when no identity", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-status-"));
    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "status", "test"]);
    const rows = getStatusRows(deps);
    expect(rows.find(([k]) => k === "fingerprint")).toBeUndefined();
  });

  it("omits expose when config has no expose", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-status-"));
    const botDir = join(mechaDir, "test");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: tmpdir() }));

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "status", "test"]);
    const rows = getStatusRows(deps);
    expect(rows.find(([k]) => k === "expose")).toBeUndefined();
  });

  it("handles bot with no workspacePath", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-status-"));
    const noWsInfo: ProcessInfo = {
      ...RUNNING_INFO,
      name: "nowstest" as BotName,
      workspacePath: undefined as unknown as string,
    };
    const deps = makeDeps({
      mechaDir,
      pm: {
        ...defaultPm(),
        get: vi.fn().mockReturnValue(noWsInfo),
        list: vi.fn().mockReturnValue([noWsInfo]),
      },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "status", "nowstest"]);
    const rows = getStatusRows(deps);
    expect(rows.find(([k]) => k === "parent")).toBeUndefined();
  });

  it("picks deepest parent when multiple ancestors exist", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-status-"));
    const root: ProcessInfo = { name: "root" as BotName, state: "running", pid: 100, port: 7700, workspacePath: "/a" };
    const mid: ProcessInfo = { name: "mid" as BotName, state: "running", pid: 101, port: 7701, workspacePath: "/a/b" };
    const leaf: ProcessInfo = { name: "leaf" as BotName, state: "running", pid: 102, port: 7702, workspacePath: "/a/b/c" };

    const deps = makeDeps({
      mechaDir,
      pm: {
        ...defaultPm(),
        get: vi.fn().mockReturnValue(leaf),
        list: vi.fn().mockReturnValue([root, mid, leaf]),
      },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "status", "leaf"]);
    expect(findRow(getStatusRows(deps), "parent")).toBe("mid");
  });

  it("handles other bot with no workspacePath in parent scan", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-status-"));
    const other: ProcessInfo = { name: "other" as BotName, state: "running", pid: 100, port: 7700, workspacePath: undefined as unknown as string };
    const child: ProcessInfo = { ...RUNNING_INFO, name: "child" as BotName, workspacePath: "/project/sub" };

    const deps = makeDeps({
      mechaDir,
      pm: {
        ...defaultPm(),
        get: vi.fn().mockReturnValue(child),
        list: vi.fn().mockReturnValue([other, child]),
      },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "status", "child"]);
    const rows = getStatusRows(deps);
    expect(rows.find(([k]) => k === "parent")).toBeUndefined();
  });

  it("includes sandbox info from state.json when present", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-status-"));
    const botDir = join(mechaDir, "test");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "state.json"), JSON.stringify({
      name: "test",
      state: "running",
      pid: 12345,
      port: 7700,
      workspacePath: tmpdir(),
      sandboxPlatform: "macos",
      sandboxMode: "auto",
    }));

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "status", "test"]);
    const rows = getStatusRows(deps);
    expect(findRow(rows, "sandboxPlatform")).toBe("macos");
    expect(findRow(rows, "sandboxMode")).toBe("auto");
  });
});

describe("bot logs command", () => {
  it("streams logs", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "logs", "test"]);
    expect(deps.processManager.logs).toHaveBeenCalledWith("test", {
      follow: undefined,
      tail: undefined,
    });
  });

  it("writes log data to stdout", async () => {
    const logStream = new Readable({
      read() {
        this.push(Buffer.from("log line\n"));
        this.push(null);
      },
    });
    const deps = makeDeps({ pm: { ...defaultPm(), logs: vi.fn().mockReturnValue(logStream) } });
    const program = createProgram(deps);
    program.exitOverride();

    const writes: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: Buffer | string) => {
      writes.push(chunk.toString());
      return true;
    }) as typeof process.stdout.write;

    try {
      await program.parseAsync(["node", "mecha", "bot", "logs", "test"]);
    } finally {
      process.stdout.write = origWrite;
    }
    expect(writes.join("")).toContain("log line");
  });

  it("rejects invalid tail value", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "logs", "test", "-n", "abc"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Tail must be"));
    expect(process.exitCode).toBe(1);

  });

  it("passes follow and tail options", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "bot", "logs", "test", "-f", "-n", "50"]);
    expect(deps.processManager.logs).toHaveBeenCalledWith("test", {
      follow: true,
      tail: 50,
    });
  });
});
