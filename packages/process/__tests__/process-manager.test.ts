import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createProcessManager } from "../src/process-manager.js";
import { readState, writeState } from "../src/state-store.js";
import type { BotState } from "../src/state-store.js";
import type { ProcessEvent } from "../src/events.js";
import type { BotName } from "@mecha/core";

const testName = "test-bot" as BotName;

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

  it("spawns a bot and returns ProcessInfo", async () => {
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

    const botDir = join(tempDir, testName);
    expect(existsSync(join(botDir, ".claude", "hooks"))).toBe(true);
    expect(existsSync(join(botDir, "tmp"))).toBe(true);
    expect(existsSync(join(botDir, ".claude", "projects"))).toBe(true);
    expect(existsSync(join(botDir, "logs"))).toBe(true);
    expect(existsSync(join(botDir, "config.json"))).toBe(true);
    expect(existsSync(join(botDir, "state.json"))).toBe(true);
    // Old home/ nesting must not exist
    expect(existsSync(join(botDir, "home"))).toBe(false);
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

    const botDir = join(tempDir, testName);
    const mode = statSync(join(botDir, "config.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("sets bot directories to mode 0o700 after spawn", async () => {
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

    const botDir = join(tempDir, testName);
    const hooksMode = statSync(join(botDir, ".claude", "hooks")).mode & 0o777;
    const tmpMode = statSync(join(botDir, "tmp")).mode & 0o777;
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

    const botDir = join(tempDir, testName);
    const guardPath = join(botDir, ".claude", "hooks", "sandbox-guard.sh");
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

    const botDir = join(tempDir, testName);
    const settings = JSON.parse(readFileSync(join(botDir, ".claude", "settings.json"), "utf-8"));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.PreToolUse).toHaveLength(2);

    expect(existsSync(join(botDir, ".claude", "hooks", "sandbox-guard.sh"))).toBe(true);
    expect(existsSync(join(botDir, ".claude", "hooks", "bash-guard.sh"))).toBe(true);
  });

  it("throws BotAlreadyExistsError for duplicate spawn", async () => {
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
    ).rejects.toThrow('bot "test-bot" already exists');
  });

  it("get returns ProcessInfo for spawned bot", async () => {
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

  it("get returns undefined for unknown bot", () => {
    const pm = createProcessManager({ mechaDir: tempDir });
    expect(pm.get("nonexistent" as BotName)).toBeUndefined();
  });

  it("list returns all bots", async () => {
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

  it("stop throws BotNotFoundError for unknown bot", async () => {
    const pm = createProcessManager({ mechaDir: tempDir });
    await expect(pm.stop("nope" as BotName)).rejects.toThrow('bot "nope" not found');
  });

  it("kill throws BotNotFoundError for unknown bot", async () => {
    const pm = createProcessManager({ mechaDir: tempDir });
    await expect(pm.kill("nope" as BotName)).rejects.toThrow('bot "nope" not found');
  });

  it("stop throws BotNotRunningError for stopped bot", async () => {
    // Write a stopped state
    const botDir = join(tempDir, "stopped-one");
    const state: BotState = {
      name: "stopped-one",
      state: "stopped",
      workspacePath: "/tmp",
    };
    writeState(botDir, state);

    const pm = createProcessManager({ mechaDir: tempDir });
    await expect(pm.stop("stopped-one" as BotName)).rejects.toThrow('bot "stopped-one" is not running');
  });

  it("getPortAndToken returns port and token for live bot", async () => {
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

  it("getPortAndToken returns undefined for non-live bot", () => {
    const pm = createProcessManager({ mechaDir: tempDir });
    expect(pm.getPortAndToken("nope" as BotName)).toBeUndefined();
  });

  it("getPortAndToken recovers port+token from config.json when bot is alive but not in live Map", () => {

    const botDir = join(tempDir, "recover-me");

    // Write state showing running with current process PID (alive)
    writeState(botDir, {
      name: "recover-me",
      state: "running",
      pid: process.pid,
      port: 7777,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    });

    // Write config.json with port+token
    writeFileSync(join(botDir, "config.json"), JSON.stringify({
      port: 7777,
      token: "mecha_recovered_token",
      workspace: "/tmp",
    }));

    // Create a NEW ProcessManager (simulating CLI restart — empty live Map)
    const pm = createProcessManager({ mechaDir: tempDir });

    const pt = pm.getPortAndToken("recover-me" as BotName);
    expect(pt).toBeDefined();
    expect(pt!.port).toBe(7777);
    expect(pt!.token).toBe("mecha_recovered_token");
  });

  it("getPortAndToken returns undefined when bot state is running but PID is dead", () => {

    const botDir = join(tempDir, "dead-recover");

    writeState(botDir, {
      name: "dead-recover",
      state: "running",
      pid: 999999999,
      port: 7778,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    });

    writeFileSync(join(botDir, "config.json"), JSON.stringify({
      port: 7778,
      token: "mecha_dead_token",
      workspace: "/tmp",
    }));

    const pm = createProcessManager({ mechaDir: tempDir });
    // PID is dead, so recovery should not return config data
    expect(pm.getPortAndToken("dead-recover" as BotName)).toBeUndefined();
  });

  it("getPortAndToken returns undefined when config.json is missing", () => {
    const botDir = join(tempDir, "no-config");

    writeState(botDir, {
      name: "no-config",
      state: "running",
      pid: process.pid,
      port: 7779,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    });

    // No config.json written
    const pm = createProcessManager({ mechaDir: tempDir });
    expect(pm.getPortAndToken("no-config" as BotName)).toBeUndefined();
  });

  it("getPortAndToken returns undefined when config.json is malformed", () => {

    const botDir = join(tempDir, "bad-config");

    writeState(botDir, {
      name: "bad-config",
      state: "running",
      pid: process.pid,
      port: 7780,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    });

    writeFileSync(join(botDir, "config.json"), "not-valid-json{{{");

    const pm = createProcessManager({ mechaDir: tempDir });
    expect(pm.getPortAndToken("bad-config" as BotName)).toBeUndefined();
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

    const events: ProcessEvent[] = [];
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

  it("marks dead running PID as error on init", () => {
    // Write a "running" state with a PID that doesn't exist
    const botDir = join(tempDir, "ghost");
    const state: BotState = {
      name: "ghost",
      state: "running",
      pid: 999999999, // very unlikely to be real
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    };
    writeState(botDir, state);

    const pm = createProcessManager({ mechaDir: tempDir });
    const info = pm.get("ghost" as BotName);
    expect(info?.state).toBe("error");
  });

  it("recovers error state to stopped on init when PID is dead", () => {
    // Write an "error" state with a dead PID — simulates prior daemon leaving error state
    const botDir = join(tempDir, "err-recovery");
    const state: BotState = {
      name: "err-recovery",
      state: "error",
      pid: 999999998,
      port: 7702,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
      stoppedAt: "2026-01-01T00:01:00Z",
    };
    writeState(botDir, state);

    const pm = createProcessManager({ mechaDir: tempDir });
    const info = pm.get("err-recovery" as BotName);
    expect(info?.state).toBe("stopped");
    expect(info?.stoppedAt).toBeDefined();
  });

  it("logs returns readable stream for existing bot", async () => {
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
    await new Promise<void>((resolve) => stream.on("close", resolve));
  });

  it("logs throws BotNotFoundError for unknown bot", () => {
    const pm = createProcessManager({ mechaDir: tempDir });
    expect(() => pm.logs("nope" as BotName)).toThrow('bot "nope" not found');
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
    expect(envArg.MECHA_BOT_NAME).toBe(testName);
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
    expect(envArg.HOME).toBe(join(tempDir, testName));
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

  it("handles async ENOENT error without crashing the process", async () => {
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

    // Simulate real Node.js behavior: spawn returns child with pid=undefined
    // and queues an async 'error' event for the next tick
    const mockSpawn = vi.fn().mockImplementation(() => {
      process.nextTick(() => {
        child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
      });
      return child;
    });

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    // Should reject with ProcessSpawnError, not crash the process
    await expect(
      pm.spawn({
        name: testName,
        workspacePath: tempDir,
        port: healthPort,
      }),
    ).rejects.toThrow("Failed to get child PID");

    // Wait for the queued error event to fire and write state — if the error
    // handler was NOT registered before the throw, this would crash with
    // "unhandled 'error' event"
    const botDir = join(tempDir, testName);
    const stateFile = join(botDir, "state.json");
    await vi.waitFor(() => {
      expect(existsSync(stateFile)).toBe(true);
    });
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(state.state).toBe("error");
    expect(state.name).toBe(testName);
  });

  it("passes log file FDs as stdio to child process", async () => {
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

    // Verify spawn was called with FD-based stdio (not "pipe")
    const spawnCall = mockSpawn.mock.calls[0];
    const stdio = spawnCall[2].stdio;
    expect(stdio[0]).toBe("ignore");
    // FDs are numbers — verify they were passed (not "pipe" strings)
    expect(typeof stdio[1]).toBe("number");
    expect(typeof stdio[2]).toBe("number");
  });

  it("stop handles running state without live handle (dead PID)", async () => {
    // Write a "running" state with a dead PID
    const botDir = join(tempDir, "orphan");
    const state: BotState = {
      name: "orphan",
      state: "running",
      pid: 999999999,
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    };
    writeState(botDir, state);

    const pm = createProcessManager({ mechaDir: tempDir });

    // After recovery, state should be stopped, so stop should throw BotNotRunningError
    await expect(pm.stop("orphan" as BotName)).rejects.toThrow('bot "orphan" is not running');
  });

  it("kill handles state without live handle (dead PID)", async () => {
    // Write a "running" state — recovery will mark it stopped
    const botDir = join(tempDir, "dead-kill");
    const state: BotState = {
      name: "dead-kill",
      state: "running",
      pid: 999999999,
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    };
    writeState(botDir, state);

    const pm = createProcessManager({ mechaDir: tempDir });
    // Kill should still work — writes stopped state
    await pm.kill("dead-kill" as BotName);
    const info = pm.get("dead-kill" as BotName);
    expect(info?.state).toBe("stopped");
  });

  it("kill with live PID but no live handle", async () => {
    // Write a running state with current process PID (which IS alive)
    const botDir = join(tempDir, "kill-live-pid");
    const state: BotState = {
      name: "kill-live-pid",
      state: "running",
      pid: process.pid, // current process — alive
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    };
    writeState(botDir, state);

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
      await pm.kill("kill-live-pid" as BotName);
      expect(killCalls.some(([, sig]) => sig === "SIGKILL")).toBe(true);
    } finally {
      process.kill = origKill;
    }
  });

  it("stop with live PID but no live handle sends SIGTERM then resolves", async () => {
    const botDir = join(tempDir, "stop-live-pid");
    const state: BotState = {
      name: "stop-live-pid",
      state: "running",
      pid: process.pid,
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    };
    writeState(botDir, state);

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
      await pm.stop("stop-live-pid" as BotName);
      expect(killCalls.some(([, sig]) => sig === "SIGTERM")).toBe(true);
    } finally {
      process.kill = origKill;
    }
  });

  it("logs returns empty stream when no log file exists", () => {
    // Write state but don't create log files
    const botDir = join(tempDir, "no-logs");
    mkdirSync(botDir, { recursive: true });
    const state: BotState = {
      name: "no-logs",
      state: "stopped",
      workspacePath: "/tmp",
    };
    writeState(botDir, state);

    const pm = createProcessManager({ mechaDir: tempDir });
    const stream = pm.logs("no-logs" as BotName);
    expect(stream).toBeDefined();
    stream.destroy();
  });

  it("list recovers dead PID state for non-live bots", () => {
    // Write a running state with dead PID
    const botDir = join(tempDir, "list-dead");
    const state: BotState = {
      name: "list-dead",
      state: "running",
      pid: 999999999,
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    };
    writeState(botDir, state);

    const pm = createProcessManager({ mechaDir: tempDir });
    const all = pm.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.state).toBe("error");
  });

  it("get recovers dead PID state for non-live bot", () => {
    const botDir = join(tempDir, "get-dead");
    const state: BotState = {
      name: "get-dead",
      state: "running",
      pid: 999999999,
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    };
    writeState(botDir, state);

    const pm = createProcessManager({ mechaDir: tempDir });
    const info = pm.get("get-dead" as BotName);
    expect(info?.state).toBe("error");
    expect(info?.stoppedAt).toBeDefined();
  });

  it("throws BotAlreadyExistsError when state shows running with alive PID", async () => {
    const botDir = join(tempDir, testName);
    const state: BotState = {
      name: testName,
      state: "running",
      pid: process.pid, // current process — alive
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    };
    writeState(botDir, state);

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
    ).rejects.toThrow('bot "test-bot" already exists');
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

  it("re-spawns bot after stop", async () => {
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

    // Re-spawn
    const info2 = await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });
    expect(info2.state).toBe("running");
    expect(info2.pid).toBe(222);
  });

  it("tracks multiple concurrent bots in live map", async () => {
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

    // Spawn first bot
    const info1 = await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    // Spawn second bot
    const info2 = await pm.spawn({
      name: "second-bot" as BotName,
      workspacePath: tempDir,
      port: healthPort,
    });

    // Both bots are live and tracked
    expect(info1.port).toBe(healthPort);
    expect(info2.name).toBe("second-bot");
    expect(info2.pid).toBe(222);
    expect(info2.port).toBe(healthPort);

    // Verify both are in the live list
    const list = pm.list();
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.name).sort()).toEqual(["second-bot", testName].sort());
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
    const botDir = join(tempDir, testName);
    expect(existsSync(join(botDir, ".claude", "hooks"))).toBe(true);
  });

  it("logs returns existing log file stream", async () => {
    // Create a bot with a log file that has content
    const botDir = join(tempDir, "with-logs");
    mkdirSync(join(botDir, "logs"), { recursive: true });
    writeFileSync(join(botDir, "logs", "stdout.log"), "line 1\nline 2\n");
    writeState(botDir, {
      name: "with-logs",
      state: "stopped",
      workspacePath: "/tmp",
    });

    const pm = createProcessManager({ mechaDir: tempDir });
    const stream = pm.logs("with-logs" as BotName);
    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as string);
    }
    expect(chunks.join("")).toContain("line 1");
  });

  it("recovery skips bots with corrupted state file", () => {
    // Create a bot dir with corrupted state.json (listBotDirs will find it, readState returns undefined)
    const botDir = join(tempDir, "corrupt-bot");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "state.json"), "not-valid-json{{{");

    // Should not throw
    const pm = createProcessManager({ mechaDir: tempDir });
    const info = pm.get("corrupt-bot" as BotName);
    expect(info).toBeUndefined();
  });

  it("recovery skips stopped bots", () => {
    const botDir = join(tempDir, "already-stopped");
    const state: BotState = {
      name: "already-stopped",
      state: "stopped",
      workspacePath: "/tmp",
    };
    writeState(botDir, state);

    const pm = createProcessManager({ mechaDir: tempDir });
    const info = pm.get("already-stopped" as BotName);
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

  it("uses constructor runtimeBin with runtimeArgs", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeBin: "/usr/local/bin/mecha",
      runtimeArgs: ["__runtime"],
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    const spawnCall = mockSpawn.mock.calls[0]!;
    expect(spawnCall[0]).toBe("/usr/local/bin/mecha");
    expect(spawnCall[1]).toEqual(["__runtime"]);
  });

  it("uses constructor runtimeBin without runtimeArgs", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeBin: "/usr/local/bin/mecha",
      // no runtimeArgs — tests the ?? [] fallback
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    const spawnCall = mockSpawn.mock.calls[0]!;
    expect(spawnCall[0]).toBe("/usr/local/bin/mecha");
    expect(spawnCall[1]).toEqual([]);
  });

  it("per-spawn runtimeBin overrides constructor runtimeBin", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeBin: "/usr/local/bin/mecha",
      runtimeArgs: ["__runtime"],
    });

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
      runtimeBin: "/custom/runtime",
    });

    const spawnCall = mockSpawn.mock.calls[0]!;
    expect(spawnCall[0]).toBe("/custom/runtime");
    expect(spawnCall[1]).toEqual([]); // per-spawn gets empty args, not constructor args
  });

  it("get detects dead PID for state written after init", () => {
    const pm = createProcessManager({ mechaDir: tempDir });

    // Write state AFTER PM init (simulating external state change)
    const botDir = join(tempDir, "late-dead");
    writeState(botDir, {
      name: "late-dead",
      state: "running",
      pid: 999999999,
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    });

    const info = pm.get("late-dead" as BotName);
    expect(info?.state).toBe("error");
    expect(info?.stoppedAt).toBeDefined();
  });

  it("list detects dead PID for state written after init", () => {
    const pm = createProcessManager({ mechaDir: tempDir });

    // Write state AFTER PM init
    const botDir = join(tempDir, "late-dead-list");
    writeState(botDir, {
      name: "late-dead-list",
      state: "running",
      pid: 999999999,
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    });

    const all = pm.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.state).toBe("error");
  });

  it("list skips bots with corrupted state file", () => {
    const botDir = join(tempDir, "corrupt-list");
    mkdirSync(botDir, { recursive: true });
    writeFileSync(join(botDir, "state.json"), "not-valid-json{{{");
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

    const events: ProcessEvent[] = [];
    pm.onEvent((e) => events.push(e));

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    // Emit exit with null code and null signal (simulates external SIGKILL on detached child)
    mockChild.emit("exit", null, null);

    // Wait for the stopped event to be emitted
    await vi.waitFor(() => {
      expect(events.find((e) => e.type === "stopped")).toBeDefined();
    });

    const stopEvent = events.find((e): e is Extract<ProcessEvent, { type: "stopped" }> => e.type === "stopped");
    expect(stopEvent).toBeDefined();
    expect(stopEvent!.exitCode).toBeUndefined();

    // code=null + signal=null/undefined = unexpected death → state should be "error"
    const state = readState(join(tempDir, testName));
    expect(state?.state).toBe("error");
  });

  it("SIGTERM exit sets state to stopped (not error)", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    const events: ProcessEvent[] = [];
    pm.onEvent((e) => events.push(e));

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    // Emit exit with signal=SIGTERM (normal bot stop)
    mockChild.emit("exit", null, "SIGTERM");

    await vi.waitFor(() => {
      expect(events.find((e) => e.type === "stopped")).toBeDefined();
    });

    const state = readState(join(tempDir, testName));
    expect(state?.state).toBe("stopped");
  });

  it("non-zero exit code sets state to error", async () => {
    const mockChild = createMockChild();
    const mockSpawn = createMockSpawn(mockChild);

    const pm = createProcessManager({
      mechaDir: tempDir,
      healthTimeoutMs: 3000,
      spawnFn: mockSpawn as any,
      runtimeEntrypoint: "/fake/runtime.js",
    });

    const events: ProcessEvent[] = [];
    pm.onEvent((e) => events.push(e));

    await pm.spawn({
      name: testName,
      workspacePath: tempDir,
      port: healthPort,
    });

    // Emit exit with non-zero code
    mockChild.emit("exit", 1, null);

    await vi.waitFor(() => {
      expect(events.find((e) => e.type === "stopped")).toBeDefined();
    });

    const state = readState(join(tempDir, testName));
    expect(state?.state).toBe("error");
    expect(state?.exitCode).toBe(1);
  });

  it("stop handles running state without live handle and dead PID", async () => {
    const pm = createProcessManager({ mechaDir: tempDir });

    // Write state AFTER init with running+dead PID
    const botDir = join(tempDir, "dead-running");
    writeState(botDir, {
      name: "dead-running",
      state: "running",
      pid: 999999999,
      port: 7701,
      workspacePath: "/tmp",
      startedAt: "2026-01-01T00:00:00Z",
    });

    // stop should succeed — PID is dead, just update state
    await pm.stop("dead-running" as BotName);
    const info = pm.get("dead-running" as BotName);
    expect(info?.state).toBe("stopped");
  });

  it("stop with PID still alive after SIGTERM waits then sends SIGKILL", async () => {
    const botDir = join(tempDir, "stubborn");
    writeState(botDir, {
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
      await pm.stop("stubborn" as BotName);
      expect(killCalls.some(([, sig]) => sig === "SIGTERM")).toBe(true);
      expect(killCalls.some(([, sig]) => sig === "SIGKILL")).toBe(true);
    } finally {
      process.kill = origKill;
      Date.now = origDateNow;
    }
  });

  it("throws InvalidNameError on invalid bot name (path traversal)", async () => {
    const { InvalidNameError } = await import("@mecha/core");
    const pm = createProcessManager({ mechaDir: tempDir, runtimeEntrypoint: "/fake/runtime.js" });
    await expect(
      pm.spawn({ name: "../etc" as BotName, workspacePath: "/ws" }),
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
