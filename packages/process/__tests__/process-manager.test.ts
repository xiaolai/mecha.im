import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createProcessManager } from "../src/process-manager.js";
import { writeState } from "../src/state-store.js";
import type { CasaState } from "../src/state-store.js";
import type { CasaName } from "@mecha/core";

const testName = "test-casa" as CasaName;

function createMockSpawn(mockChild: EventEmitter & { pid: number; killed: boolean; kill: ReturnType<typeof vi.fn>; unref: ReturnType<typeof vi.fn>; stdout: EventEmitter | null; stderr: EventEmitter | null }) {
  return vi.fn().mockReturnValue(mockChild);
}

function createMockChild(pid = 12345) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
    unref: ReturnType<typeof vi.fn>;
    stdout: EventEmitter | null;
    stderr: EventEmitter | null;
  };
  child.pid = pid;
  child.killed = false;
  child.kill = vi.fn((signal?: string) => {
    child.killed = true;
    // Simulate exit on kill
    process.nextTick(() => child.emit("exit", signal === "SIGKILL" ? 137 : 0));
    return true;
  });
  child.unref = vi.fn();
  // Mock stdout/stderr as readable-like
  child.stdout = null;
  child.stderr = null;
  return child;
}

describe("createProcessManager", () => {
  let tempDir: string;
  let healthServer: Server;
  let healthPort: number;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-pm-test-"));
    mkdirSync(join(tempDir, "casas"), { recursive: true });

    // Start a health server
    healthServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    healthPort = await new Promise<number>((resolve) => {
      healthServer.listen(0, "127.0.0.1", () => {
        const addr = healthServer.address();
        resolve((addr as { port: number }).port);
      });
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    return new Promise<void>((resolve) => {
      if (healthServer?.listening) {
        healthServer.close(() => resolve());
      } else {
        resolve();
      }
    });
  });

  it("spawns a CASA and returns ProcessInfo", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    const info = await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    expect(info.name).toBe(testName);
    expect(info.state).toBe("running");
    expect(info.pid).toBe(12345);
    expect(info.port).toBe(healthPort);
    expect(info.token).toBeDefined();
    expect(info.startedAt).toBeDefined();
    expect(mockSpawn).toHaveBeenCalledOnce();
  });

  it("creates directory structure on spawn", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    const casaDir = join(tempDir, "casas", testName);
    expect(existsSync(join(casaDir, "home", ".claude", "hooks"))).toBe(true);
    expect(existsSync(join(casaDir, "tmp"))).toBe(true);
    expect(existsSync(join(casaDir, "sessions"))).toBe(true);
    expect(existsSync(join(casaDir, "logs"))).toBe(true);
    expect(existsSync(join(casaDir, "config.json"))).toBe(true);
    expect(existsSync(join(casaDir, "state.json"))).toBe(true);
  });

  it("sets config.json to mode 0o600 after spawn", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    const casaDir = join(tempDir, "casas", testName);
    const mode = statSync(join(casaDir, "config.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("sets CASA directories to mode 0o700 after spawn", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    const casaDir = join(tempDir, "casas", testName);
    const hooksMode = statSync(join(casaDir, "home", ".claude", "hooks")).mode & 0o777;
    const tmpMode = statSync(join(casaDir, "tmp")).mode & 0o777;
    expect(hooksMode).toBe(0o700);
    expect(tmpMode).toBe(0o700);
  });

  it("sandbox guard rejects sibling paths", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    const casaDir = join(tempDir, "casas", testName);
    const guardPath = join(casaDir, "home", ".claude", "hooks", "sandbox-guard.sh");
    const script = readFileSync(guardPath, "utf-8");

    // The guard should use strict path matching with "/" separator on canonicalized vars
    expect(script).toContain('"$SANDBOX"/*|"$SANDBOX")');
    expect(script).toContain('"$WORKSPACE"/*|"$WORKSPACE")');
    // Should NOT have the old loose pattern (raw env var with glob)
    expect(script).not.toMatch(/"\$MECHA_SANDBOX_ROOT"\*\)/);
  });

  it("writes sandbox hooks on spawn", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    const casaDir = join(tempDir, "casas", testName);
    const settings = JSON.parse(readFileSync(join(casaDir, "home", ".claude", "settings.json"), "utf-8"));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.PreToolUse).toHaveLength(2);

    expect(existsSync(join(casaDir, "home", ".claude", "hooks", "sandbox-guard.sh"))).toBe(true);
    expect(existsSync(join(casaDir, "home", ".claude", "hooks", "bash-guard.sh"))).toBe(true);
  });

  it("throws CasaAlreadyExistsError for duplicate spawn", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    await expect(
      pm.spawn({
        name: testName,
        workspacePath: tempDir,
        port: healthPort,
      }),
    ).rejects.toThrow('CASA "test-casa" already exists');
  });

  it("get returns ProcessInfo for spawned CASA", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    const info = pm.get(testName);
    expect(info).toBeDefined();
    expect(info!.name).toBe(testName);
    expect(info!.state).toBe("running");
  });

  it("get returns undefined for unknown CASA", () => {
    const pm = createProcessManager({ mechaDir: tempDir });
    expect(pm.get("nonexistent" as CasaName)).toBeUndefined();
  });

  it("list returns all CASAs", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    const all = pm.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe(testName);
  });

  it("stop sends SIGTERM to child", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    await pm.stop(testName);
    expect(mockChild.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("kill sends SIGKILL to child", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    await pm.kill(testName);
    expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("stop throws CasaNotFoundError for unknown CASA", async () => {
    const pm = createProcessManager({ mechaDir: tempDir });
    await expect(pm.stop("nope" as CasaName)).rejects.toThrow('CASA "nope" not found');
  });

  it("kill throws CasaNotFoundError for unknown CASA", async () => {
    const pm = createProcessManager({ mechaDir: tempDir });
    await expect(pm.kill("nope" as CasaName)).rejects.toThrow('CASA "nope" not found');
  });

  it("stop throws CasaNotRunningError for stopped CASA", async () => {
    // Write a stopped state
    const casaDir = join(tempDir, "casas", "stopped-one");
    const state: CasaState = {
      name: "stopped-one",
      state: "stopped",
      workspacePath: "/tmp",
    };
    writeState(casaDir, state);

    const pm = createProcessManager({ mechaDir: tempDir });
    await expect(pm.stop("stopped-one" as CasaName)).rejects.toThrow('CASA "stopped-one" is not running');
  });

  it("getPortAndToken returns port and token for live CASA", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    const info = await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    const pt = pm.getPortAndToken(testName);
    expect(pt).toBeDefined();
    expect(pt!.port).toBe(healthPort);
    expect(pt!.token).toBe(info.token);
  });

  it("getPortAndToken returns undefined for non-live CASA", () => {
    const pm = createProcessManager({ mechaDir: tempDir });
    expect(pm.getPortAndToken("nope" as CasaName)).toBeUndefined();
  });

  it("getPortAndToken recovers port+token from config.json when CASA is alive but not in live Map", () => {
    const { writeFileSync: wf } = require("node:fs");
    const casaDir = join(tempDir, "casas", "recover-me");

    // Write state showing running with current process PID (alive)
    writeState(casaDir, {
      name: "recover-me",
      state: "running",
      pid: process.pid,
      port: 7777,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    });

    // Write config.json with port+token
    wf(join(casaDir, "config.json"), JSON.stringify({
      port: 7777,
      token: "mecha_recovered_token",
      workspace: "/tmp",
    }));

    // Create a NEW ProcessManager (simulating CLI restart — empty live Map)
    const pm = createProcessManager({ mechaDir: tempDir });

    const pt = pm.getPortAndToken("recover-me" as CasaName);
    expect(pt).toBeDefined();
    expect(pt!.port).toBe(7777);
    expect(pt!.token).toBe("mecha_recovered_token");
  });

  it("getPortAndToken returns undefined when CASA state is running but PID is dead", () => {
    const { writeFileSync: wf } = require("node:fs");
    const casaDir = join(tempDir, "casas", "dead-recover");

    writeState(casaDir, {
      name: "dead-recover",
      state: "running",
      pid: 999999999,
      port: 7778,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    });

    wf(join(casaDir, "config.json"), JSON.stringify({
      port: 7778,
      token: "mecha_dead_token",
      workspace: "/tmp",
    }));

    const pm = createProcessManager({ mechaDir: tempDir });
    // PID is dead, so recovery should not return config data
    expect(pm.getPortAndToken("dead-recover" as CasaName)).toBeUndefined();
  });

  it("getPortAndToken returns undefined when config.json is missing", () => {
    const casaDir = join(tempDir, "casas", "no-config");

    writeState(casaDir, {
      name: "no-config",
      state: "running",
      pid: process.pid,
      port: 7779,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    });

    // No config.json written
    const pm = createProcessManager({ mechaDir: tempDir });
    expect(pm.getPortAndToken("no-config" as CasaName)).toBeUndefined();
  });

  it("getPortAndToken returns undefined when config.json is malformed", () => {
    const { writeFileSync: wf } = require("node:fs");
    const casaDir = join(tempDir, "casas", "bad-config");

    writeState(casaDir, {
      name: "bad-config",
      state: "running",
      pid: process.pid,
      port: 7780,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    });

    wf(join(casaDir, "config.json"), "not-valid-json{{{");

    const pm = createProcessManager({ mechaDir: tempDir });
    expect(pm.getPortAndToken("bad-config" as CasaName)).toBeUndefined();
  });

  it("onEvent fires on spawn", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    const events: any[] = [];
    pm.onEvent((e) => events.push(e));

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("spawned");
    expect(events[0].name).toBe(testName);
  });

  it("recovers stopped state on init when PID is dead", () => {
    // Write a "running" state with a PID that doesn't exist
    const casaDir = join(tempDir, "casas", "ghost");
    const state: CasaState = {
      name: "ghost",
      state: "running",
      pid: 999999999, // very unlikely to be real
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    };
    writeState(casaDir, state);

    const pm = createProcessManager({ mechaDir: tempDir });
    const info = pm.get("ghost" as CasaName);
    expect(info?.state).toBe("stopped");
  });

  it("logs returns readable stream for existing CASA", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    const stream = pm.logs(testName);
    expect(stream).toBeDefined();
    stream.destroy();
  });

  it("logs throws CasaNotFoundError for unknown CASA", () => {
    const pm = createProcessManager({ mechaDir: tempDir });
    expect(() => pm.logs("nope" as CasaName)).toThrow('CASA "nope" not found');
  });

  it("passes custom env to child process", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
      env: { CUSTOM_VAR: "custom_value" },
    });

    const spawnCall = mockSpawn.mock.calls[0]!;
    const envArg = spawnCall[2]?.env as Record<string, string>;
    expect(envArg.CUSTOM_VAR).toBe("custom_value");
    expect(envArg.MECHA_CASA_NAME).toBe(testName);
    expect(envArg.MECHA_PORT).toBe(String(healthPort));
  });

  it("filters reserved env keys from user env", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
      env: { SAFE_KEY: "ok", MECHA_AUTH_TOKEN: "should-be-ignored", HOME: "/evil" },
    });

    const spawnCall = mockSpawn.mock.calls[0]!;
    const envArg = spawnCall[2]?.env as Record<string, string>;
    expect(envArg.SAFE_KEY).toBe("ok");
    // Security vars applied last — user overrides are stripped
    expect(envArg.MECHA_AUTH_TOKEN).toMatch(/^mecha_/);
    expect(envArg.HOME).toContain("home"); // casaDir/home, not /evil
  });

  it("throws ProcessSpawnError when spawnFn throws", async () => {
    const mockSpawn = vi.fn(() => {
      throw new Error("spawn ENOENT");
    });

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await expect(
      pm.spawn({
        name: testName,
        workspacePath: tempDir,
        port: healthPort,
      }),
    ).rejects.toThrow("spawn ENOENT");
  });

  it("throws ProcessSpawnError when child has no PID", async () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: undefined;
      killed: boolean;
      kill: ReturnType<typeof vi.fn>;
      unref: ReturnType<typeof vi.fn>;
      stdout: EventEmitter | null;
      stderr: EventEmitter | null;
    };
    child.pid = undefined;
    child.killed = false;
    child.kill = vi.fn();
    child.unref = vi.fn();
    child.stdout = null;
    child.stderr = null;

    const mockSpawn = vi.fn().mockReturnValue(child);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await expect(
      pm.spawn({
        name: testName,
        workspacePath: tempDir,
        port: healthPort,
      }),
    ).rejects.toThrow("Failed to get child PID");
  });

  it("pipes stdout and stderr to log files when available", async () => {
    const mockChild = createMockChild();
    // Add mock stdout and stderr streams
    mockChild.stdout = new EventEmitter() as any;
    (mockChild.stdout as any).pipe = vi.fn();
    mockChild.stderr = new EventEmitter() as any;
    (mockChild.stderr as any).pipe = vi.fn();

    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    expect((mockChild.stdout as any).pipe).toHaveBeenCalled();
    expect((mockChild.stderr as any).pipe).toHaveBeenCalled();
  });

  it("stop handles running state without live handle (dead PID)", async () => {
    // Write a "running" state with a dead PID
    const casaDir = join(tempDir, "casas", "orphan");
    const state: CasaState = {
      name: "orphan",
      state: "running",
      pid: 999999999,
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    };
    writeState(casaDir, state);

    const pm = createProcessManager({ mechaDir: tempDir });

    // After recovery, state should be stopped, so stop should throw CasaNotRunningError
    await expect(pm.stop("orphan" as CasaName)).rejects.toThrow('CASA "orphan" is not running');
  });

  it("kill handles state without live handle (dead PID)", async () => {
    // Write a "running" state — recovery will mark it stopped
    const casaDir = join(tempDir, "casas", "dead-kill");
    const state: CasaState = {
      name: "dead-kill",
      state: "running",
      pid: 999999999,
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    };
    writeState(casaDir, state);

    const pm = createProcessManager({ mechaDir: tempDir });
    // Kill should still work — writes stopped state
    await pm.kill("dead-kill" as CasaName);
    const info = pm.get("dead-kill" as CasaName);
    expect(info?.state).toBe("stopped");
  });

  it("kill with live PID but no live handle", async () => {
    // Write a running state with current process PID (which IS alive)
    const casaDir = join(tempDir, "casas", "kill-live-pid");
    const state: CasaState = {
      name: "kill-live-pid",
      state: "running",
      pid: process.pid, // current process — alive
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    };
    writeState(casaDir, state);

    // Create PM AFTER writing state so recovery sees it alive
    // But we need to mock process.kill to avoid actually sending SIGKILL
    const origKill = process.kill;
    const killCalls: Array<[number, string | number]> = [];
    process.kill = ((pid: number, signal?: string | number) => {
      killCalls.push([pid, signal ?? 0]);
      if (signal === 0) return true; // alive check
      if (signal === "SIGKILL") return true; // accept kill
      return origKill(pid, signal as any);
    }) as any;

    try {
      const pm = createProcessManager({ mechaDir: tempDir });
      await pm.kill("kill-live-pid" as CasaName);
      expect(killCalls.some(([, sig]) => sig === "SIGKILL")).toBe(true);
    } finally {
      process.kill = origKill;
    }
  });

  it("stop with live PID but no live handle sends SIGTERM then resolves", async () => {
    const casaDir = join(tempDir, "casas", "stop-live-pid");
    const state: CasaState = {
      name: "stop-live-pid",
      state: "running",
      pid: process.pid,
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    };
    writeState(casaDir, state);

    const origKill = process.kill;
    const killCalls: Array<[number, string | number]> = [];
    let callCount = 0;
    process.kill = ((pid: number, signal?: string | number) => {
      killCalls.push([pid, signal ?? 0]);
      if (signal === 0) {
        callCount++;
        // After SIGTERM, simulate PID dying after a few alive checks
        if (callCount > 3) throw new Error("ESRCH");
        return true;
      }
      if (signal === "SIGTERM" || signal === "SIGKILL") return true;
      return origKill(pid, signal as any);
    }) as any;

    try {
      const pm = createProcessManager({ mechaDir: tempDir });
      await pm.stop("stop-live-pid" as CasaName);
      expect(killCalls.some(([, sig]) => sig === "SIGTERM")).toBe(true);
    } finally {
      process.kill = origKill;
    }
  });

  it("logs returns empty stream when no log file exists", () => {
    // Write state but don't create log files
    const casaDir = join(tempDir, "casas", "no-logs");
    mkdirSync(casaDir, { recursive: true });
    const state: CasaState = {
      name: "no-logs",
      state: "stopped",
      workspacePath: "/tmp",
    };
    writeState(casaDir, state);

    const pm = createProcessManager({ mechaDir: tempDir });
    const stream = pm.logs("no-logs" as CasaName);
    expect(stream).toBeDefined();
    stream.destroy();
  });

  it("list recovers dead PID state for non-live CASAs", () => {
    // Write a running state with dead PID
    const casaDir = join(tempDir, "casas", "list-dead");
    const state: CasaState = {
      name: "list-dead",
      state: "running",
      pid: 999999999,
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    };
    writeState(casaDir, state);

    const pm = createProcessManager({ mechaDir: tempDir });
    const all = pm.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.state).toBe("stopped");
  });

  it("get recovers dead PID state for non-live CASA", () => {
    const casaDir = join(tempDir, "casas", "get-dead");
    const state: CasaState = {
      name: "get-dead",
      state: "running",
      pid: 999999999,
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    };
    writeState(casaDir, state);

    const pm = createProcessManager({ mechaDir: tempDir });
    const info = pm.get("get-dead" as CasaName);
    expect(info?.state).toBe("stopped");
    expect(info?.stoppedAt).toBeDefined();
  });

  it("throws CasaAlreadyExistsError when state shows running with alive PID", async () => {
    const casaDir = join(tempDir, "casas", testName);
    const state: CasaState = {
      name: testName,
      state: "running",
      pid: process.pid, // current process — alive
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    };
    writeState(casaDir, state);

    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await expect(
      pm.spawn({
        name: testName,
        workspacePath: tempDir,
        port: healthPort,
      }),
    ).rejects.toThrow('CASA "test-casa" already exists');
  });

  it("stop escalates to SIGKILL when child does not exit after SIGTERM", async () => {
    const mockChild = createMockChild();
    // Override kill to NOT emit exit on SIGTERM (simulating stuck process)
    mockChild.kill = vi.fn((signal?: string) => {
      if (signal === "SIGKILL") {
        mockChild.killed = true;
        process.nextTick(() => mockChild.emit("exit", 137));
      }
      // SIGTERM: do nothing — child stays alive
      return true;
    });
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    // Use fake timers to avoid 5s wait
    vi.useFakeTimers();
    const stopPromise = pm.stop(testName);
    // Advance past _waitForChildExit timeout
    await vi.advanceTimersByTimeAsync(6000);
    vi.useRealTimers();
    await stopPromise;

    expect(mockChild.kill).toHaveBeenCalledWith("SIGTERM");
    expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("re-spawns CASA after stop (workspace symlink already exists)", async () => {
    const mockChild1 = createMockChild(111);
    const mockChild2 = createMockChild(222);
    let callCount = 0;
    const mockSpawn = vi.fn(() => {
      callCount++;
      return callCount === 1 ? mockChild1 : mockChild2;
    });

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    // Spawn then stop
    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });
    await pm.stop(testName);

    // Re-spawn — workspace symlink already exists
    const info2 = await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });
    expect(info2.state).toBe("running");
    expect(info2.pid).toBe(222);
  });

  it("collects used ports from live processes on spawn", async () => {
    const mockChild1 = createMockChild(111);
    const mockChild2 = createMockChild(222);
    let callCount = 0;
    const mockSpawn = vi.fn(() => {
      callCount++;
      return callCount === 1 ? mockChild1 : mockChild2;
    });

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    // Spawn first CASA
    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    // Spawn second CASA with a different name and same health port
    const secondPort = healthPort; // reuse same health server
    const info2 = await pm.spawn({
      name: "second-casa" as CasaName,
      workspacePath: tempDir,
      port: secondPort,
    });

    expect(info2.name).toBe("second-casa");
    expect(info2.pid).toBe(222);
  });

  it("auto-allocates port when not provided", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 500,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    // No port provided — allocatePort will find a free port, but health check
    // will fail because no server is listening. We just want to verify the
    // allocatePort branch is exercised.
    await expect(
      pm.spawn({
        name: testName,
        workspacePath: tempDir,
        // no port
      }),
    ).rejects.toThrow(); // health check timeout

    // Verify spawn was called (directory creation happened)
    expect(mockSpawn).toHaveBeenCalledOnce();
    const casaDir = join(tempDir, "casas", testName);
    expect(existsSync(join(casaDir, "home", ".claude", "hooks"))).toBe(true);
  });

  it("logs returns existing log file stream", async () => {
    // Create a CASA with a log file that has content
    const casaDir = join(tempDir, "casas", "with-logs");
    mkdirSync(join(casaDir, "logs"), { recursive: true });
    const { writeFileSync: wf } = await import("node:fs");
    wf(join(casaDir, "logs", "stdout.log"), "line 1\nline 2\n");
    writeState(casaDir, {
      name: "with-logs",
      state: "stopped",
      workspacePath: "/tmp",
    });

    const pm = createProcessManager({ mechaDir: tempDir });
    const stream = pm.logs("with-logs" as CasaName);
    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as string);
    }
    expect(chunks.join("")).toContain("line 1");
  });

  it("recovery skips casas with no state file", () => {
    // Create a casa dir with no state.json
    mkdirSync(join(tempDir, "casas", "empty-casa"), { recursive: true });

    // Should not throw
    const pm = createProcessManager({ mechaDir: tempDir });
    const info = pm.get("empty-casa" as CasaName);
    expect(info).toBeUndefined();
  });

  it("recovery skips stopped casas", () => {
    const casaDir = join(tempDir, "casas", "already-stopped");
    const state: CasaState = {
      name: "already-stopped",
      state: "stopped",
      workspacePath: "/tmp",
    };
    writeState(casaDir, state);

    const pm = createProcessManager({ mechaDir: tempDir });
    const info = pm.get("already-stopped" as CasaName);
    expect(info?.state).toBe("stopped");
  });

  it("throws ProcessSpawnError with non-Error throw value", async () => {
    const mockSpawn = vi.fn(() => {
      throw "string error"; // eslint-disable-line no-throw-literal
    });

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await expect(
      pm.spawn({
        name: testName,
        workspacePath: tempDir,
        port: healthPort,
      }),
    ).rejects.toThrow("string error");
  });

  it("uses runtimeBin when provided", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
      runtimeBin: "/usr/local/bin/custom-runtime",
    });

    const spawnCall = mockSpawn.mock.calls[0]!;
    expect(spawnCall[0]).toBe("/usr/local/bin/custom-runtime");
    expect(spawnCall[1]).toEqual([]); // no args when runtimeBin is provided
  });

  it("get detects dead PID for state written after init", () => {
    const pm = createProcessManager({ mechaDir: tempDir });

    // Write state AFTER PM init (simulating external state change)
    const casaDir = join(tempDir, "casas", "late-dead");
    writeState(casaDir, {
      name: "late-dead",
      state: "running",
      pid: 999999999,
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    });

    const info = pm.get("late-dead" as CasaName);
    expect(info?.state).toBe("stopped");
    expect(info?.stoppedAt).toBeDefined();
  });

  it("list detects dead PID for state written after init", () => {
    const pm = createProcessManager({ mechaDir: tempDir });

    // Write state AFTER PM init
    const casaDir = join(tempDir, "casas", "late-dead-list");
    writeState(casaDir, {
      name: "late-dead-list",
      state: "running",
      pid: 999999999,
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    });

    const all = pm.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.state).toBe("stopped");
  });

  it("list skips casas with no state file", () => {
    mkdirSync(join(tempDir, "casas", "no-state"), { recursive: true });
    const pm = createProcessManager({ mechaDir: tempDir });
    expect(pm.list()).toHaveLength(0);
  });

  it("child exit handler handles null code and pid", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    const events: any[] = [];
    pm.onEvent((e) => events.push(e));

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    // Emit exit with null code (simulates signal termination)
    mockChild.emit("exit", null);

    // Wait for next tick
    await new Promise((r) => setTimeout(r, 50));

    const stopEvent = events.find((e) => e.type === "stopped");
    expect(stopEvent).toBeDefined();
    expect(stopEvent.exitCode).toBeUndefined();
  });

  it("stop handles running state without live handle and dead PID", async () => {
    const pm = createProcessManager({ mechaDir: tempDir });

    // Write state AFTER init with running+dead PID
    const casaDir = join(tempDir, "casas", "dead-running");
    writeState(casaDir, {
      name: "dead-running",
      state: "running",
      pid: 999999999,
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    });

    // stop should succeed — PID is dead, just update state
    await pm.stop("dead-running" as CasaName);
    const info = pm.get("dead-running" as CasaName);
    expect(info?.state).toBe("stopped");
  });

  it("stop with PID still alive after SIGTERM waits then sends SIGKILL", async () => {
    const casaDir = join(tempDir, "casas", "stubborn");
    writeState(casaDir, {
      name: "stubborn",
      state: "running",
      pid: process.pid,
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    });

    const origKill = process.kill;
    const killCalls: Array<[number, string | number]> = [];
    let aliveChecks = 0;
    process.kill = ((pid: number, signal?: string | number) => {
      killCalls.push([pid, signal ?? 0]);
      if (signal === 0) {
        aliveChecks++;
        // PID stays alive forever (forces SIGKILL escalation)
        return true;
      }
      if (signal === "SIGTERM" || signal === "SIGKILL") return true;
      return origKill(pid, signal as any);
    }) as any;

    // Mock Date.now to make _waitForPidExit timeout quickly
    const origDateNow = Date.now;
    let time = origDateNow();
    Date.now = () => {
      time += 6000; // Jump 6s on every call, exceeding the 5s timeout
      return time;
    };

    try {
      const pm = createProcessManager({ mechaDir: tempDir });
      await pm.stop("stubborn" as CasaName);
      expect(killCalls.some(([, sig]) => sig === "SIGTERM")).toBe(true);
      expect(killCalls.some(([, sig]) => sig === "SIGKILL")).toBe(true);
    } finally {
      process.kill = origKill;
      Date.now = origDateNow;
    }
  });

  it("throws InvalidNameError on invalid CASA name (path traversal)", async () => {
    const { InvalidNameError } = await import("@mecha/core");
    const pm = createProcessManager({ mechaDir: tempDir, runtimeEntrypoint: "/fake/runtime.js" });
    await expect(
      pm.spawn({ name: "../etc" as CasaName, workspacePath: "/ws" }),
    ).rejects.toThrow(InvalidNameError);
  });

  it("throws ProcessSpawnError when no runtimeEntrypoint and no runtimeBin", async () => {
    const mockChild = createMockChild();
    const pm = createProcessManager({
      mechaDir: tempDir,
      spawnFn: createMockSpawn(mockChild) as unknown as typeof import("node:child_process").spawn,
    });
    await expect(
      pm.spawn({ name: testName, workspacePath: "/ws" }),
    ).rejects.toThrow("No runtimeEntrypoint configured");
  });
});
