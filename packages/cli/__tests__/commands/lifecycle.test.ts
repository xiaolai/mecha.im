import { describe, it, expect, vi, afterEach } from "vitest";
import { Readable } from "node:stream";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { ProcessManager, ProcessInfo } from "@mecha/process";
import type { CasaName } from "@mecha/core";

const RUNNING_INFO: ProcessInfo = {
  name: "test" as CasaName,
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

describe("spawn command", () => {
  it("spawns a CASA", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "spawn", "researcher", "/home/user/research"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ name: "researcher", workspacePath: "/home/user/research" }),
    );
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Spawned"));
  });

  it("spawns with port option", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "spawn", "test", "/ws", "--port", "7701"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ port: 7701 }),
    );
  });

  it("rejects invalid port value", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "spawn", "test", "/ws", "--port", "abc"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Port must be"));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined as unknown as number;
  });

  it("spawns with tags option", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "spawn", "test", "/ws", "--tags", "dev,research, ml"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["dev", "research", "ml"] }),
    );
  });

  it("rejects invalid tags", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "spawn", "test", "/ws", "--tags", "has space,ok"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("invalid characters"));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined as unknown as number;
  });

  it("spawns with auth option", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "spawn", "test", "/ws", "--auth", "personal"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ auth: "personal" }),
    );
  });

  it("spawns with expose option", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "spawn", "test", "/ws", "--expose", "query,read_workspace"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ expose: ["query", "read_workspace"] }),
    );
  });

  it("rejects invalid expose capability", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "spawn", "test", "/ws", "--expose", "bogus"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Invalid capability"));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined as unknown as number;
  });

  it("spawns with sandbox mode option", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "spawn", "test", "/ws", "--sandbox", "require"]);
    expect(deps.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxMode: "require" }),
    );
  });

  it("rejects invalid sandbox mode", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "spawn", "test", "/ws", "--sandbox", "bogus"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Sandbox mode must be"));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined as unknown as number;
  });

  it("subscribes to warning events during spawn", async () => {
    const onEventMock = vi.fn().mockReturnValue(() => {});
    const deps = makeDeps({ pm: { ...defaultPm(), onEvent: onEventMock } });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "spawn", "test", "/ws"]);
    expect(onEventMock).toHaveBeenCalled();
  });
});

describe("kill command", () => {
  it("kills a CASA", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "kill", "researcher"]);
    expect(deps.processManager.kill).toHaveBeenCalledWith("researcher");
    expect(deps.formatter.success).toHaveBeenCalledWith(expect.stringContaining("Killed"));
  });
});

describe("ls command", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); });

  function writeCasaConfig(name: string, tags: string[]): void {
    const dir = join(mechaDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws", tags }));
  }

  it("lists CASAs with tags", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-ls-"));
    writeCasaConfig("test", ["code", "dev"]);
    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "ls"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Name", "State", "Port", "PID", "Tags"],
      [["test", "running", "7700", "12345", "code, dev"]],
    );
  });

  it("shows message when no CASAs", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-ls-"));
    const deps = makeDeps({ mechaDir, pm: { ...defaultPm(), list: vi.fn().mockReturnValue([]) } });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "ls"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No CASAs running");
  });

  it("shows dash for undefined port/pid and empty tags", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-ls-"));
    const dir = join(mechaDir, "x");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const deps = makeDeps({
      mechaDir,
      pm: {
        ...defaultPm(),
        list: vi.fn().mockReturnValue([
          { name: "x", state: "stopped", port: undefined, pid: undefined, workspacePath: "/ws" },
        ]),
      },
    });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "ls"]);
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
      name: "parent" as CasaName,
      state: "running",
      pid: 1000,
      port: 7700,
      workspacePath: "/project",
    };
    const childInfo: ProcessInfo = {
      name: "child" as CasaName,
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

    await program.parseAsync(["node", "mecha", "ls"]);
    const tableCall = (deps.formatter.table as ReturnType<typeof vi.fn>).mock.calls[0];
    const rows = tableCall[1] as string[][];
    // Parent at depth 0 — no indent
    expect(rows[0][0]).toBe("parent");
    // Child at depth 1 — indented
    expect(rows[1][0]).toBe("  child");
  });
});

describe("status command", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); });

  it("shows CASA status without token", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "status", "test"]);
    const jsonArg = (deps.formatter.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonArg).not.toHaveProperty("token");
    expect(jsonArg.name).toBe("test");
    expect(jsonArg.state).toBe("running");
  });

  it("includes fingerprint when identity exists", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-status-"));
    const casaDir = join(mechaDir, "test");
    mkdirSync(casaDir, { recursive: true });
    writeFileSync(join(casaDir, "identity.json"), JSON.stringify({
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

    await program.parseAsync(["node", "mecha", "status", "test"]);
    const jsonArg = (deps.formatter.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonArg.fingerprint).toBe("sha256:abcdef");
  });

  it("includes expose when config has it", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-status-"));
    const casaDir = join(mechaDir, "test");
    mkdirSync(casaDir, { recursive: true });
    writeFileSync(join(casaDir, "config.json"), JSON.stringify({
      port: 7700, token: "t", workspace: "/ws", expose: ["query", "read_workspace"],
    }));

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "status", "test"]);
    const jsonArg = (deps.formatter.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonArg.expose).toEqual(["query", "read_workspace"]);
  });

  it("includes parent when workspace is nested", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-status-"));
    const parentInfo: ProcessInfo = {
      name: "parent" as CasaName,
      state: "running",
      pid: 1000,
      port: 7700,
      workspacePath: "/project",
    };
    const childInfo: ProcessInfo = {
      ...RUNNING_INFO,
      name: "child" as CasaName,
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

    await program.parseAsync(["node", "mecha", "status", "child"]);
    const jsonArg = (deps.formatter.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonArg.parent).toBe("parent");
  });

  it("omits parent when workspace is not nested", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "status", "test"]);
    const jsonArg = (deps.formatter.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonArg).not.toHaveProperty("parent");
  });

  it("omits fingerprint when no identity", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-status-"));
    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "status", "test"]);
    const jsonArg = (deps.formatter.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonArg).not.toHaveProperty("fingerprint");
  });

  it("omits expose when config has no expose", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-status-"));
    const casaDir = join(mechaDir, "test");
    mkdirSync(casaDir, { recursive: true });
    writeFileSync(join(casaDir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "status", "test"]);
    const jsonArg = (deps.formatter.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonArg).not.toHaveProperty("expose");
  });

  it("handles CASA with no workspacePath", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-status-"));
    const noWsInfo: ProcessInfo = {
      ...RUNNING_INFO,
      name: "nowstest" as CasaName,
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

    await program.parseAsync(["node", "mecha", "status", "nowstest"]);
    const jsonArg = (deps.formatter.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonArg).not.toHaveProperty("parent");
  });

  it("picks deepest parent when multiple ancestors exist", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-status-"));
    const root: ProcessInfo = { name: "root" as CasaName, state: "running", pid: 100, port: 7700, workspacePath: "/a" };
    const mid: ProcessInfo = { name: "mid" as CasaName, state: "running", pid: 101, port: 7701, workspacePath: "/a/b" };
    const leaf: ProcessInfo = { name: "leaf" as CasaName, state: "running", pid: 102, port: 7702, workspacePath: "/a/b/c" };

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

    await program.parseAsync(["node", "mecha", "status", "leaf"]);
    const jsonArg = (deps.formatter.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonArg.parent).toBe("mid");
  });

  it("handles other CASA with no workspacePath in parent scan", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-status-"));
    const other: ProcessInfo = { name: "other" as CasaName, state: "running", pid: 100, port: 7700, workspacePath: undefined as unknown as string };
    const child: ProcessInfo = { ...RUNNING_INFO, name: "child" as CasaName, workspacePath: "/project/sub" };

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

    await program.parseAsync(["node", "mecha", "status", "child"]);
    const jsonArg = (deps.formatter.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonArg).not.toHaveProperty("parent");
  });

  it("includes sandbox info from state.json when present", async () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-status-"));
    const casaDir = join(mechaDir, "test");
    mkdirSync(casaDir, { recursive: true });
    writeFileSync(join(casaDir, "state.json"), JSON.stringify({
      name: "test",
      state: "running",
      pid: 12345,
      port: 7700,
      workspacePath: "/ws",
      sandboxPlatform: "macos",
      sandboxMode: "auto",
    }));

    const deps = makeDeps({ mechaDir, pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "status", "test"]);
    const jsonArg = (deps.formatter.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonArg.sandboxPlatform).toBe("macos");
    expect(jsonArg.sandboxMode).toBe("auto");
  });
});

describe("logs command", () => {
  it("streams logs", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "logs", "test"]);
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
      await program.parseAsync(["node", "mecha", "logs", "test"]);
    } finally {
      process.stdout.write = origWrite;
    }
    expect(writes.join("")).toContain("log line");
  });

  it("rejects invalid tail value", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "logs", "test", "-n", "abc"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(expect.stringContaining("Tail must be"));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined as unknown as number;
  });

  it("passes follow and tail options", async () => {
    const deps = makeDeps({ pm: defaultPm() });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "logs", "test", "-f", "-n", "50"]);
    expect(deps.processManager.logs).toHaveBeenCalledWith("test", {
      follow: true,
      tail: 50,
    });
  });
});
