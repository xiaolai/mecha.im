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

/** UUID v4 pattern */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
    get: vi.fn().mockImplementation((name: string) =>
      running ? { name, state: "running", workspacePath: "/ws", port: 7700 } : undefined,
    ),
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

  it("spawns PTY with --resume for existing session ID", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    const session = pm.spawn("coder", "sess-1", 80, 24);
    expect(spawnFn).toHaveBeenCalledWith(
      expect.stringContaining("claude"),
      expect.arrayContaining(["--resume", "sess-1"]),
      expect.objectContaining({ cwd: "/workspace" }),
    );
    expect(session.id).toBe("coder:sess-1");
    expect(session.claudeSessionId).toBe("sess-1");
  });

  it("spawns new session with --session-id UUID when no sessionId", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    const session = pm.spawn("coder", undefined, 80, 24);
    // Should pass --session-id with a real UUID
    const args = spawnFn.mock.calls[0][1] as string[];
    const sessionIdIdx = args.indexOf("--session-id");
    expect(sessionIdIdx).toBeGreaterThanOrEqual(0);
    expect(args[sessionIdIdx + 1]).toMatch(UUID_RE);
    // Internal key uses the same UUID
    expect(session.claudeSessionId).toMatch(UUID_RE);
    expect(session.id).toBe(`coder:${session.claudeSessionId}`);
  });

  it("treats new-* session IDs as new sessions with --session-id", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    const session = pm.spawn("coder", "new-abc123", 80, 24);
    // Should NOT pass --resume with a new-* ID
    const args = spawnFn.mock.calls[0][1] as string[];
    expect(args).not.toContain("--resume");
    // Should generate a real UUID via --session-id
    expect(args).toContain("--session-id");
    expect(session.claudeSessionId).toMatch(UUID_RE);
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

  it("attach disconnects previous client (single-client model)", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn, idleTimeoutMs: 1000 });
    const session = pm.spawn("coder", "s1", 80, 24);
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    pm.attach(session.id, ws1);
    pm.attach(session.id, ws2);
    // ws1 should be disconnected
    expect(ws1.close).toHaveBeenCalledWith(4001, "Replaced by new client");
    expect(session.clients.has(ws1)).toBe(false);
    expect(session.clients.has(ws2)).toBe(true);
    expect(session.clients.size).toBe(1);
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

    it("updates ordering when PTY output changes lastActivity", () => {
      const pty1 = createMockPty();
      const pty2 = createMockPty();
      let call = 0;
      const multiSpawn = vi.fn().mockImplementation(() => ++call === 1 ? pty1 : pty2);

      const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn: multiSpawn });
      const s1 = pm.spawn("coder", "s1", 80, 24);
      vi.advanceTimersByTime(3000);
      pm.spawn("coder", "s2", 80, 24);

      // s2 is more recent — verify initial ordering
      expect(pm.findByBot("coder")[0]!.id).toBe("coder:s2");

      // PTY output on s1 updates its lastActivity
      vi.advanceTimersByTime(1000);
      pty1._emitData("output");

      // Now s1 should be first (most recently active)
      expect(pm.findByBot("coder")[0]).toBe(s1);
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

    it("trims scrollback when byte cap is exceeded", () => {
      const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
      const session = pm.spawn("coder", "s1", 80, 24);
      // 512 KB cap = 524288 bytes. Push 6 chunks of 100KB each (600KB total)
      const bigChunk = "x".repeat(100 * 1024);
      for (let i = 0; i < 6; i++) {
        mockPty._emitData(bigChunk);
      }
      // Should have trimmed oldest chunks to stay under 512KB
      expect(session.scrollback.length).toBeLessThan(6);
      const totalBytes = session.scrollback.reduce((sum, c) => sum + Buffer.byteLength(c, "utf8"), 0);
      expect(totalBytes).toBeLessThanOrEqual(512 * 1024);
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
