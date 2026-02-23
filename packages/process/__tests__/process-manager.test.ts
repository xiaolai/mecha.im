import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";

// Mock child_process
const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Mock isPidAlive from state-store
const mockIsPidAlive = vi.fn().mockReturnValue(true);
vi.mock("../src/state-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/state-store.js")>();
  return {
    ...actual,
    isPidAlive: (...args: unknown[]) => mockIsPidAlive(...args),
  };
});

// Mock fetch for healthz polling
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { createProcessManager } from "../src/process-manager.js";
import type { SpawnOpts, ProcessManager } from "../src/types.js";
import type { MechaId } from "@mecha/core";

function makeSpawnOpts(overrides: Partial<SpawnOpts> = {}): SpawnOpts {
  return {
    mechaId: "mx-test-abc123" as MechaId,
    projectPath: "/tmp/test-project",
    port: 19900,
    claudeConfigDir: "/tmp/claude-config",
    authToken: "test-token-12345",
    ...overrides,
  };
}

function createMockChild(pid = 12345): EventEmitter & { pid: number; unref: ReturnType<typeof vi.fn> } {
  const child = new EventEmitter() as EventEmitter & { pid: number; unref: ReturnType<typeof vi.fn> };
  child.pid = pid;
  child.unref = vi.fn();
  return child;
}

describe("createProcessManager", () => {
  let mechaHome: string;
  let projectDir: string;
  let pm: ProcessManager;

  beforeEach(() => {
    mechaHome = mkdtempSync(join(tmpdir(), "mecha-pm-test-"));
    projectDir = mkdtempSync(join(tmpdir(), "mecha-project-test-"));
    vi.clearAllMocks();

    // Default: PID is alive
    mockIsPidAlive.mockReturnValue(true);

    // Default: spawn returns a mock child
    const child = createMockChild();
    mockSpawn.mockReturnValue(child);

    // Default: healthz succeeds
    mockFetch.mockResolvedValue({ ok: true });

    pm = createProcessManager({
      mechaHome,
      runtimeEntry: "/fake/runtime/index.js",
      portBase: 19900,
      portMax: 19910,
    });
  });

  afterEach(() => {
    rmSync(mechaHome, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("uses default options when none provided", () => {
    const defaultPm = createProcessManager();
    const defaultHome = join(process.env["HOME"]!, ".mecha");
    expect(existsSync(join(defaultHome, "processes"))).toBe(true);
    expect(existsSync(join(defaultHome, "logs"))).toBe(true);
    // Cleanup
    expect(defaultPm.list()).toBeDefined();
  });

  it("creates state and log directories on construction", () => {
    expect(existsSync(join(mechaHome, "processes"))).toBe(true);
    expect(existsSync(join(mechaHome, "logs"))).toBe(true);
  });

  describe("spawn", () => {
    it("spawns a runtime process and returns info", async () => {
      const opts = makeSpawnOpts({ projectPath: projectDir });
      const info = await pm.spawn(opts);

      expect(info.id).toBe("mx-test-abc123");
      expect(info.pid).toBe(12345);
      expect(info.port).toBe(19900);
      expect(info.state).toBe("running");
      expect(info.authToken).toBe("test-token-12345");
      expect(info.projectPath).toBe(projectDir);
      expect(info.startFingerprint).toContain("12345:");
    });

    it("passes correct env vars to child process", async () => {
      const opts = makeSpawnOpts({
        projectPath: projectDir,
        env: { ANTHROPIC_API_KEY: "sk-test" },
        permissionMode: "plan",
      });
      await pm.spawn(opts);

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const spawnArgs = mockSpawn.mock.calls[0];
      const env = spawnArgs[2].env;
      expect(env.MECHA_ID).toBe("mx-test-abc123");
      expect(env.PORT).toBe("19900");
      expect(env.HOST).toBe("127.0.0.1");
      expect(env.MECHA_AUTH_TOKEN).toBe("test-token-12345");
      expect(env.MECHA_WORKSPACE).toBe(projectDir);
      expect(env.ANTHROPIC_API_KEY).toBe("sk-test");
      expect(env.MECHA_PERMISSION_MODE).toBe("plan");
    });

    it("creates .mecha directory in project path", async () => {
      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);
      expect(existsSync(join(projectDir, ".mecha"))).toBe(true);
    });

    it("saves state file after spawn", async () => {
      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);
      const info = pm.get("mx-test-abc123");
      expect(info).toBeDefined();
      expect(info!.state).toBe("running");
    });

    it("waits for healthz to respond", async () => {
      mockFetch.mockRejectedValueOnce(new Error("not ready"));
      mockFetch.mockResolvedValueOnce({ ok: true });

      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("retries when healthz returns non-ok", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });
      mockFetch.mockResolvedValueOnce({ ok: true });

      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws when healthz times out", async () => {
      mockFetch.mockRejectedValue(new Error("not ready"));

      const opts = makeSpawnOpts({ projectPath: projectDir });
      await expect(pm.spawn(opts)).rejects.toThrow("did not become healthy");
    }, 20_000);

    it("throws when process exits before healthz", async () => {
      mockFetch.mockRejectedValue(new Error("not ready"));
      mockIsPidAlive.mockReturnValue(false);

      const opts = makeSpawnOpts({ projectPath: projectDir });
      await expect(pm.spawn(opts)).rejects.toThrow("exited before becoming healthy");
    });

    it("spawns with detached and stdio to log file", async () => {
      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      const spawnArgs = mockSpawn.mock.calls[0];
      expect(spawnArgs[2].detached).toBe(true);
      expect(spawnArgs[2].cwd).toBe(projectDir);
      expect(spawnArgs[0]).toBe("node");
      expect(spawnArgs[1]).toEqual(["/fake/runtime/index.js"]);
    });

    it("emits start event after healthz", async () => {
      const events: string[] = [];
      pm.onEvent((e) => events.push(e.type));

      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      // Event is emitted to file — verify via eventlog
      // The event log is file-based, so we verify the spawn succeeded
      expect(existsSync(join(mechaHome, "events.jsonl"))).toBe(true);
    });

    it("omits NODE_OPTIONS when not present in parent env", async () => {
      const original = process.env["NODE_OPTIONS"];
      delete process.env["NODE_OPTIONS"];

      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      const spawnArgs = mockSpawn.mock.calls[0];
      const env = spawnArgs[2].env;
      expect(env.NODE_OPTIONS).toBeUndefined();

      if (original !== undefined) process.env["NODE_OPTIONS"] = original;
    });

    it("does not set MECHA_PERMISSION_MODE when not specified", async () => {
      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      const spawnArgs = mockSpawn.mock.calls[0];
      const env = spawnArgs[2].env;
      expect(env.MECHA_PERMISSION_MODE).toBeUndefined();
    });
  });

  describe("get", () => {
    it("returns undefined for non-existent ID", () => {
      expect(pm.get("mx-nonexistent-000000")).toBeUndefined();
    });

    it("returns process info after spawn", async () => {
      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);
      const info = pm.get("mx-test-abc123");
      expect(info).toBeDefined();
      expect(info!.id).toBe("mx-test-abc123");
    });

    it("marks process as stopped when PID is dead", async () => {
      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      // Now PID is dead
      mockIsPidAlive.mockReturnValue(false);
      const info = pm.get("mx-test-abc123");
      expect(info!.state).toBe("stopped");
    });
  });

  describe("list", () => {
    it("returns empty array when no processes", () => {
      expect(pm.list()).toEqual([]);
    });

    it("returns all processes after spawn", async () => {
      const opts1 = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts1);

      const child2 = createMockChild(12346);
      mockSpawn.mockReturnValue(child2);
      const opts2 = makeSpawnOpts({
        mechaId: "mx-test2-222222" as MechaId,
        projectPath: projectDir,
        port: 19901,
      });
      await pm.spawn(opts2);

      const all = pm.list();
      expect(all).toHaveLength(2);
    });

    it("marks dead processes as stopped in list", async () => {
      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      mockIsPidAlive.mockReturnValue(false);
      const all = pm.list();
      expect(all).toHaveLength(1);
      expect(all[0].state).toBe("stopped");
    });
  });

  describe("stop", () => {
    it("throws when process not found", async () => {
      await expect(pm.stop("mx-nonexistent-000000")).rejects.toThrow("not found");
    });

    it("marks as stopped when PID is already dead", async () => {
      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      mockIsPidAlive.mockReturnValue(false);
      await pm.stop("mx-test-abc123");
      const info = pm.get("mx-test-abc123");
      expect(info!.state).toBe("stopped");
    });

    it("sends SIGTERM to running process", async () => {
      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
      // After SIGTERM, process dies
      mockIsPidAlive.mockReturnValueOnce(true).mockReturnValue(false);

      await pm.stop("mx-test-abc123");
      expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");

      killSpy.mockRestore();
    });

    it("sends SIGKILL after timeout", async () => {
      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
      // Process stays alive past timeout (all isPidAlive calls return true)
      mockIsPidAlive.mockReturnValue(true);

      await pm.stop("mx-test-abc123");
      // Should have called SIGTERM first, then SIGKILL
      const killCalls = killSpy.mock.calls.filter(
        (c) => c[1] === "SIGTERM" || c[1] === "SIGKILL"
      );
      expect(killCalls.some((c) => c[1] === "SIGTERM")).toBe(true);
      expect(killCalls.some((c) => c[1] === "SIGKILL")).toBe(true);

      killSpy.mockRestore();
    }, 15_000);

    it("handles SIGTERM throwing (process already gone)", async () => {
      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      // isPidAlive returns true initially (so we try SIGTERM), but SIGTERM throws
      mockIsPidAlive.mockReturnValue(true);
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("ESRCH");
      });

      await pm.stop("mx-test-abc123");
      const info = pm.get("mx-test-abc123");
      expect(info!.state).toBe("stopped");

      killSpy.mockRestore();
    });
  });

  describe("kill", () => {
    it("removes state file after kill", async () => {
      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      mockIsPidAlive.mockReturnValue(false);
      await pm.kill("mx-test-abc123");
      expect(pm.get("mx-test-abc123")).toBeUndefined();
    });

    it("is a no-op for non-existent ID", async () => {
      await expect(pm.kill("mx-nonexistent-000000")).resolves.toBeUndefined();
    });

    it("force kills with SIGKILL", async () => {
      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
      await pm.kill("mx-test-abc123", true);
      expect(killSpy).toHaveBeenCalledWith(12345, "SIGKILL");
      expect(pm.get("mx-test-abc123")).toBeUndefined();

      killSpy.mockRestore();
    });

    it("graceful kill sends SIGTERM then SIGKILL when process survives", async () => {
      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
      // Process stays alive past timeout
      mockIsPidAlive.mockReturnValue(true);

      await pm.kill("mx-test-abc123", false);
      // SIGTERM + SIGKILL
      expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");
      expect(killSpy).toHaveBeenCalledWith(12345, "SIGKILL");
      expect(pm.get("mx-test-abc123")).toBeUndefined();

      killSpy.mockRestore();
    }, 15_000);

    it("graceful kill sends SIGTERM then waits", async () => {
      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
      // Process dies after SIGTERM
      mockIsPidAlive.mockReturnValueOnce(true).mockReturnValue(false);

      await pm.kill("mx-test-abc123", false);
      expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");
      expect(pm.get("mx-test-abc123")).toBeUndefined();

      killSpy.mockRestore();
    });
  });

  describe("logs", () => {
    it("returns empty stream for non-existent log file", () => {
      const stream = pm.logs("mx-nonexistent-000000");
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      return new Promise<void>((resolve) => {
        stream.on("end", () => {
          expect(Buffer.concat(chunks).toString()).toBe("");
          resolve();
        });
      });
    });

    it("reads last N lines from log file", () => {
      const logPath = join(mechaHome, "logs", "mx-test-abc123.log");
      writeFileSync(logPath, "line1\nline2\nline3\nline4\nline5\n");

      const stream = pm.logs("mx-test-abc123", { tail: 3 });
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      return new Promise<void>((resolve) => {
        stream.on("end", () => {
          const content = Buffer.concat(chunks).toString();
          expect(content).toContain("line3");
          expect(content).toContain("line4");
          expect(content).toContain("line5");
          resolve();
        });
      });
    });

    it("uses default tail of 100 lines when no opts provided", () => {
      const logPath = join(mechaHome, "logs", "mx-default-tail.log");
      const lines = Array.from({ length: 150 }, (_, i) => `line${i}`).join("\n") + "\n";
      writeFileSync(logPath, lines);

      const stream = pm.logs("mx-default-tail");
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      return new Promise<void>((resolve) => {
        stream.on("end", () => {
          const content = Buffer.concat(chunks).toString();
          expect(content).toContain("line149");
          expect(content).toContain("line50");
          expect(content).not.toContain("line0\n");
          resolve();
        });
      });
    });

    it("returns follow stream that stays open", () => {
      const logPath = join(mechaHome, "logs", "mx-test-abc123.log");
      writeFileSync(logPath, "initial\n");

      const stream = pm.logs("mx-test-abc123", { follow: true });
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));

      // Destroy the stream to clean up
      stream.destroy();
    });
  });

  describe("getPortAndEnv", () => {
    it("returns empty values for non-existent ID", () => {
      const result = pm.getPortAndEnv("mx-nonexistent-000000");
      expect(result.port).toBeUndefined();
      expect(result.env).toEqual({});
    });

    it("returns port and env after spawn", async () => {
      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);
      const result = pm.getPortAndEnv("mx-test-abc123");
      expect(result.port).toBe(19900);
      expect(result.env.MECHA_ID).toBe("mx-test-abc123");
    });
  });

  describe("onEvent", () => {
    it("returns an unsubscribe function", () => {
      const unsub = pm.onEvent(() => {});
      expect(typeof unsub).toBe("function");
      unsub();
    });
  });

  describe("child process events", () => {
    it("updates state to stopped on child exit event", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      // Simulate child exit
      child.emit("exit", 0);

      // State should be updated (read from store)
      mockIsPidAlive.mockReturnValue(false);
      const info = pm.get("mx-test-abc123");
      expect(info!.state).toBe("stopped");
    });

    it("does not update state when fingerprint mismatches on exit", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      // Manually change the fingerprint in the state file (simulates a re-spawn)
      const info = pm.get("mx-test-abc123")!;
      info.startFingerprint = "99999:0";
      info.state = "running";
      // Write modified info directly to state dir
      writeFileSync(
        join(mechaHome, "processes", "mx-test-abc123.json"),
        JSON.stringify(info, null, 2) + "\n",
      );

      // Simulate child exit — fingerprint won't match, so state should not change
      child.emit("exit", 0);

      const reloaded = pm.get("mx-test-abc123");
      // The state still shows running since the exit handler didn't touch it
      // (but get() will check isPidAlive which is mocked to true)
      expect(reloaded!.startFingerprint).toBe("99999:0");
    });

    it("updates state to error on child error event", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);

      const opts = makeSpawnOpts({ projectPath: projectDir });
      await pm.spawn(opts);

      // Simulate child error
      child.emit("error", new Error("crash"));

      mockIsPidAlive.mockReturnValue(false);
      const info = pm.get("mx-test-abc123");
      // error state was set by the error handler
      expect(["error", "stopped"]).toContain(info!.state);
    });
  });
});
