import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("@mecha/core", () => ({
  readCasaConfig: vi.fn(),
}));

import { readCasaConfig } from "@mecha/core";
import { createPtyManager } from "../src/lib/pty-manager.js";
import type { ProcessManager, MechaPty } from "@mecha/process";
import type { WebSocket } from "ws";

const mockReadCasaConfig = vi.mocked(readCasaConfig);

function createMockPty(): MechaPty & { _emitExit: (code: number) => void; _emitData: (data: string) => void } {
  const emitter = new EventEmitter();
  const pty = {
    onData: (cb: (data: string) => void) => {
      emitter.on("data", cb);
      return { dispose: () => emitter.removeListener("data", cb) };
    },
    onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => {
      emitter.on("exit", cb);
      return { dispose: () => emitter.removeListener("exit", cb) };
    },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    _emitExit(code: number) { emitter.emit("exit", { exitCode: code }); },
    _emitData(data: string) { emitter.emit("data", data); },
  };
  return pty as unknown as MechaPty & { _emitExit: (code: number) => void; _emitData: (data: string) => void };
}

function createMockPm(running = true): ProcessManager {
  return {
    spawn: vi.fn(),
    get: vi.fn().mockReturnValue(running ? { name: "coder", state: "running", workspacePath: "/ws", port: 7700 } : undefined),
    list: vi.fn().mockReturnValue([]),
    stop: vi.fn(),
    kill: vi.fn(),
    logs: vi.fn(),
    getPortAndToken: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
  } as unknown as ProcessManager;
}

function createMockWs(): WebSocket {
  return { readyState: 1, OPEN: 1, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
}

describe("createPtyManager", () => {
  let mockPty: ReturnType<typeof createMockPty>;
  let spawnFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockPty = createMockPty();
    spawnFn = vi.fn().mockReturnValue(mockPty);
    mockReadCasaConfig.mockReturnValue({ port: 7700, token: "tok", workspace: "/workspace" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("spawns PTY with correct args (no session)", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    const session = pm.spawn("coder", undefined, 120, 40);

    expect(spawnFn).toHaveBeenCalledWith("claude", [], expect.objectContaining({
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd: "/workspace",
    }));
    expect(session.casaName).toBe("coder");
    expect(session.id).toMatch(/^coder:new-/);
  });

  it("spawns PTY with --resume when sessionId provided", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    const session = pm.spawn("coder", "sess-123", 80, 24);

    expect(spawnFn).toHaveBeenCalledWith("claude", ["--resume", "sess-123"], expect.any(Object));
    expect(session.id).toBe("coder:sess-123");
  });

  it("throws when CASA not found", () => {
    const pm = createPtyManager({ processManager: createMockPm(false), mechaDir: "/m", spawnFn });
    expect(() => pm.spawn("ghost", undefined, 80, 24)).toThrow("not running");
  });

  it("throws when CASA is stopped", () => {
    const mockPm = createMockPm();
    (mockPm.get as ReturnType<typeof vi.fn>).mockReturnValue({ name: "coder", state: "stopped", workspacePath: "/ws" });
    const pm = createPtyManager({ processManager: mockPm, mechaDir: "/m", spawnFn });
    expect(() => pm.spawn("coder", undefined, 80, 24)).toThrow("not running");
  });

  it("throws when config unreadable", () => {
    mockReadCasaConfig.mockReturnValue(undefined);
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    expect(() => pm.spawn("coder", undefined, 80, 24)).toThrow("Cannot read config");
  });

  it("throws when max sessions exceeded", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn, maxSessions: 1 });
    pm.spawn("coder", undefined, 80, 24);
    expect(() => pm.spawn("coder", "s2", 80, 24)).toThrow("Max PTY sessions (1)");
  });

  it("attach adds client to existing session", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    const session = pm.spawn("coder", "s1", 80, 24);
    const ws = createMockWs();
    const result = pm.attach(session.id, ws);
    expect(result).toBe(session);
    expect(session.clients.has(ws)).toBe(true);
  });

  it("attach returns null for nonexistent session", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    expect(pm.attach("nope", createMockWs())).toBeNull();
  });

  it("detach removes client, starts idle timer", () => {
    const pm = createPtyManager({
      processManager: createMockPm(), mechaDir: "/m", spawnFn, idleTimeoutMs: 1000,
    });
    const session = pm.spawn("coder", "s1", 80, 24);
    const ws = createMockWs();
    pm.attach(session.id, ws);
    pm.detach(session.id, ws);
    expect(session.clients.size).toBe(0);
    // Session still alive before timeout
    expect(pm.getSession(session.id)).toBe(session);
  });

  it("detach with remaining clients does not start idle timer", () => {
    const pm = createPtyManager({
      processManager: createMockPm(), mechaDir: "/m", spawnFn, idleTimeoutMs: 1000,
    });
    const session = pm.spawn("coder", "s1", 80, 24);
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    pm.attach(session.id, ws1);
    pm.attach(session.id, ws2);
    pm.detach(session.id, ws1);
    // Still one client — session stays alive even after timeout
    vi.advanceTimersByTime(2000);
    expect(pm.getSession(session.id)).toBe(session);
  });

  it("idle timeout kills PTY after all clients detach", () => {
    const pm = createPtyManager({
      processManager: createMockPm(), mechaDir: "/m", spawnFn, idleTimeoutMs: 5000,
    });
    const session = pm.spawn("coder", "s1", 80, 24);
    const ws = createMockWs();
    pm.attach(session.id, ws);
    pm.detach(session.id, ws);

    vi.advanceTimersByTime(5000);
    expect(mockPty.kill).toHaveBeenCalled();
    expect(pm.getSession(session.id)).toBeNull();
  });

  it("reattach cancels idle timer", () => {
    const pm = createPtyManager({
      processManager: createMockPm(), mechaDir: "/m", spawnFn, idleTimeoutMs: 5000,
    });
    const session = pm.spawn("coder", "s1", 80, 24);
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    pm.attach(session.id, ws1);
    pm.detach(session.id, ws1);

    // Reattach before timeout
    vi.advanceTimersByTime(3000);
    pm.attach(session.id, ws2);
    vi.advanceTimersByTime(5000);
    // Should NOT be killed
    expect(pm.getSession(session.id)).toBe(session);
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

  it("listSessions returns all active sessions", () => {
    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn });
    pm.spawn("coder", "s1", 80, 24);
    pm.spawn("coder", "s2", 80, 24);
    expect(pm.listSessions()).toHaveLength(2);
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
    const multiSpawn = vi.fn().mockImplementation(() => {
      call++;
      return call === 1 ? pty1 : pty2;
    });

    const pm = createPtyManager({ processManager: createMockPm(), mechaDir: "/m", spawnFn: multiSpawn });
    pm.spawn("coder", "s1", 80, 24);
    pm.spawn("coder", "s2", 80, 24);
    pm.shutdown();
    expect(pty1.kill).toHaveBeenCalled();
    expect(pty2.kill).toHaveBeenCalled();
    expect(pm.listSessions()).toHaveLength(0);
  });
});
