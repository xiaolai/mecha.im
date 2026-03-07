import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("@mecha/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/core")>();
  return { ...actual, readBotConfig: vi.fn() };
});

import { readBotConfig } from "@mecha/core";
import { createPtyManager } from "../src/pty-manager.js";
import type { ProcessManager, MechaPty } from "@mecha/process";
import type { WebSocket } from "ws";

const mockReadBotConfig = vi.mocked(readBotConfig);

function createMockPty(): MechaPty & { _emitData: (d: string) => void; _emitExit: (code: number) => void } {
  const emitter = new EventEmitter();
  return {
    onData: (cb: (d: string) => void) => { emitter.on("data", cb); return { dispose: () => emitter.removeListener("data", cb) }; },
    onExit: (cb: (e: { exitCode: number }) => void) => { emitter.on("exit", cb); return { dispose: () => emitter.removeListener("exit", cb) }; },
    write: vi.fn(), resize: vi.fn(), kill: vi.fn(),
    _emitData(d: string) { emitter.emit("data", d); },
    _emitExit(code: number) { emitter.emit("exit", { exitCode: code }); },
  } as unknown as MechaPty & { _emitData: (d: string) => void; _emitExit: (code: number) => void };
}

function createMockPm(running = true): ProcessManager {
  return {
    spawn: vi.fn(),
    get: vi.fn().mockReturnValue(running ? { name: "coder", state: "running", workspacePath: "/ws", port: 7700 } : undefined),
    list: vi.fn().mockReturnValue([]),
    stop: vi.fn(), kill: vi.fn(), logs: vi.fn(), getPortAndToken: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
  } as unknown as ProcessManager;
}

function createMockWs(): WebSocket {
  return { readyState: 1, OPEN: 1, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
}

describe("agent createPtyManager", () => {
  let mockPty: ReturnType<typeof createMockPty>;
  let spawnFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockPty = createMockPty();
    spawnFn = vi.fn().mockReturnValue(mockPty);
    mockReadBotConfig.mockReturnValue({ port: 7700, token: "tok", workspace: "/workspace" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("spawns PTY with correct args", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    const session = pm.spawn("coder", "sess-1", 80, 24);
    expect(spawnFn).toHaveBeenCalledWith(expect.stringContaining("claude"), ["--resume", "sess-1"], expect.objectContaining({ cwd: "/workspace" }));
    expect(session.id).toBe("coder:sess-1");
  });

  it("spawns new session without sessionId", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    const session = pm.spawn("coder", undefined, 80, 24);
    expect(spawnFn).toHaveBeenCalledWith(expect.stringContaining("claude"), [], expect.any(Object));
    expect(session.id).toMatch(/^coder:new-/);
  });

  it("treats new-* session IDs as new sessions (no --resume)", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    const session = pm.spawn("coder", "new-abc123", 80, 24);
    // Should NOT pass --resume with a new-* ID (it's mecha-internal, not a real Claude session)
    expect(spawnFn).toHaveBeenCalledWith(expect.stringContaining("claude"), [], expect.any(Object));
    // Should generate a fresh key (not reuse the new-abc123)
    expect(session.id).toMatch(/^coder:new-/);
  });

  it("throws when bot not running", () => {
    const pm = createPtyManager({ processManager: createMockPm(false), mechaDir: "/m", spawnFn });
    expect(() => pm.spawn("ghost", undefined, 80, 24)).toThrow("not running");
  });

  it("throws when config unreadable", () => {
    mockReadBotConfig.mockReturnValue(undefined);
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    expect(() => pm.spawn("coder", undefined, 80, 24)).toThrow("Cannot read config");
  });

  it("throws when max sessions exceeded", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn, maxSessions: 1 });
    pm.spawn("coder", undefined, 80, 24);
    expect(() => pm.spawn("coder", "s2", 80, 24)).toThrow("Max PTY sessions");
  });

  it("attach and detach lifecycle", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn, idleTimeoutMs: 1000 });
    const session = pm.spawn("coder", "s1", 80, 24);
    const ws = createMockWs();
    expect(pm.attach(session.id, ws)).toBe(session);
    expect(session.clients.has(ws)).toBe(true);

    pm.detach(session.id, ws);
    expect(session.clients.size).toBe(0);

    // Idle timeout kills
    vi.advanceTimersByTime(1000);
    expect(mockPty.kill).toHaveBeenCalled();
    expect(pm.getSession(session.id)).toBeNull();
  });

  it("attach returns null for nonexistent session", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    expect(pm.attach("nope", createMockWs())).toBeNull();
  });

  it("resize updates PTY dimensions", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    const session = pm.spawn("coder", "s1", 80, 24);
    pm.resize(session.id, 120, 40);
    expect(mockPty.resize).toHaveBeenCalledWith(120, 40);
  });

  it("resize on nonexistent session is a no-op", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    pm.resize("nope", 120, 40); // should not throw
  });

  it("detach on nonexistent session is a no-op", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    pm.detach("nope", createMockWs()); // should not throw
  });

  it("PTY exit cleans up session", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    const session = pm.spawn("coder", "s1", 80, 24);
    mockPty._emitExit(0);
    expect(pm.getSession(session.id)).toBeNull();
  });

  it("shutdown kills all sessions", () => {
    const pty1 = createMockPty();
    const pty2 = createMockPty();
    let call = 0;
    const multiSpawn = vi.fn().mockImplementation(() => ++call === 1 ? pty1 : pty2);

    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn: multiSpawn });
    pm.spawn("coder", "s1", 80, 24);
    vi.advanceTimersByTime(3000);
    pm.spawn("coder", "s2", 80, 24);
    pm.shutdown();
    expect(pty1.kill).toHaveBeenCalled();
    expect(pty2.kill).toHaveBeenCalled();
  });

  it("detach with remaining clients does not start idle timer", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn, idleTimeoutMs: 1000 });
    const session = pm.spawn("coder", "s1", 80, 24);
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    pm.attach(session.id, ws1);
    pm.attach(session.id, ws2);
    pm.detach(session.id, ws1);
    vi.advanceTimersByTime(2000);
    expect(pm.getSession(session.id)).toBe(session);
  });

  it("attach cancels pending idle timer", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn, idleTimeoutMs: 1000 });
    const session = pm.spawn("coder", "s1", 80, 24);
    const ws1 = createMockWs();
    pm.attach(session.id, ws1);
    pm.detach(session.id, ws1); // starts idle timer

    // Re-attach before timer fires — clearIdleTimer clears the pending timer
    const ws2 = createMockWs();
    pm.attach(session.id, ws2);
    vi.advanceTimersByTime(2000);
    expect(pm.getSession(session.id)).toBe(session); // still alive
  });

  it("throws when bot is stopped", () => {
    const mockPm = createMockPm();
    (mockPm.get as ReturnType<typeof vi.fn>).mockReturnValue({ name: "coder", state: "stopped", workspacePath: "/ws" });
    const pm = createPtyManager({ processManager: mockPm, mechaDir: "/m", spawnFn });
    expect(() => pm.spawn("coder", undefined, 80, 24)).toThrow("not running");
  });

  describe("findByBot", () => {
    it("returns sessions for a given bot sorted by lastActivity DESC", () => {
      const pty1 = createMockPty();
      const pty2 = createMockPty();
      let call = 0;
      const multiSpawn = vi.fn().mockImplementation(() => ++call === 1 ? pty1 : pty2);

      const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn: multiSpawn });
      const s1 = pm.spawn("coder", "s1", 80, 24);
      vi.advanceTimersByTime(3000);
      const s2 = pm.spawn("coder", "s2", 80, 24);

      const results = pm.findByBot("coder");
      expect(results).toHaveLength(2);
      // s2 was spawned later (more recent lastActivity)
      expect(results[0]).toBe(s2);
      expect(results[1]).toBe(s1);
    });

    it("returns empty array when no sessions match", () => {
      const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
      pm.spawn("coder", "s1", 80, 24);
      expect(pm.findByBot("other")).toEqual([]);
    });
  });

  describe("scrollback buffer", () => {
    it("captures PTY output into scrollback", () => {
      const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
      const session = pm.spawn("coder", "s1", 80, 24);
      mockPty._emitData("line1");
      mockPty._emitData("line2");
      expect(session.scrollback).toEqual(["line1", "line2"]);
    });

    it("limits scrollback to SCROLLBACK_LIMIT chunks", () => {
      const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
      const session = pm.spawn("coder", "s1", 80, 24);
      // Emit 250 chunks (limit is 200)
      for (let i = 0; i < 250; i++) {
        mockPty._emitData(`chunk-${i}`);
      }
      expect(session.scrollback).toHaveLength(200);
      // Oldest chunks should be dropped
      expect(session.scrollback[0]).toBe("chunk-50");
      expect(session.scrollback[199]).toBe("chunk-249");
    });
  });

  it("rejects spawn within cooldown period", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn, spawnCooldownMs: 2000 });
    pm.spawn("coder", "s1", 80, 24);
    expect(() => pm.spawn("coder", "s2", 80, 24)).toThrow("Too many spawn requests");
    // After cooldown expires, spawn should succeed
    vi.advanceTimersByTime(2000);
    expect(() => pm.spawn("coder", "s3", 80, 24)).not.toThrow();
  });

  it("allows rapid spawns for different bots", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn, spawnCooldownMs: 2000 });
    pm.spawn("coder", "s1", 80, 24);
    // Different bot name should not be rate-limited
    expect(() => pm.spawn("writer", "s1", 80, 24)).not.toThrow();
  });

  it("failed spawn does not consume cooldown", () => {
    const pm = createPtyManager({ processManager: createMockPm(false), mechaDir: "/m", spawnFn, spawnCooldownMs: 2000 });
    // First spawn fails (bot not running) — should not set cooldown
    expect(() => pm.spawn("ghost", undefined, 80, 24)).toThrow("not running");
    // Immediate retry should throw "not running" again, NOT "Too many spawn requests"
    expect(() => pm.spawn("ghost", undefined, 80, 24)).toThrow("not running");
  });

  it("uses default idle timeout of 5 minutes", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    const session = pm.spawn("coder", "s1", 80, 24);
    const ws = createMockWs();
    pm.attach(session.id, ws);
    pm.detach(session.id, ws);

    // Should still be alive at 4 minutes
    vi.advanceTimersByTime(4 * 60 * 1000);
    expect(pm.getSession(session.id)).toBe(session);

    // Should be killed at 5 minutes
    vi.advanceTimersByTime(1 * 60 * 1000);
    expect(pm.getSession(session.id)).toBeNull();
  });
});
