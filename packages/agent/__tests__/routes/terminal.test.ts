import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { registerTerminalRoutes } from "../../src/routes/terminal.js";
import type { PtyManager, PtySession } from "../../src/pty-manager.js";
import type { FastifyInstance } from "fastify";
import type { MechaPty } from "@mecha/process";

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

function createMockPtyManager(): PtyManager & { _sessions: Map<string, PtySession> } {
  const sessions = new Map<string, PtySession>();
  return {
    _sessions: sessions,
    spawn: vi.fn().mockImplementation((botName: string, sessionId: string | undefined) => {
      // Mirror real pty-manager: new-* or missing → generate UUID; otherwise use as-is
      const isNew = !sessionId || sessionId.startsWith("new-");
      const claudeSessionId = isNew ? "mock-uuid-1234" : sessionId;
      const id = `${botName}:${claudeSessionId}`;
      const pty = createMockPty();
      const session: PtySession = { id, claudeSessionId, botName, pty, clients: new Set(), createdAt: new Date(), lastActivity: new Date(), scrollback: [] };
      sessions.set(id, session);
      return session;
    }),
    attach: vi.fn().mockImplementation((key: string, ws: unknown) => {
      const s = sessions.get(key);
      if (s) s.clients.add(ws as never);
      return s ?? null;
    }),
    detach: vi.fn(),
    resize: vi.fn(),
    getSession: vi.fn().mockImplementation((key: string) => sessions.get(key) ?? null),
    findByBot: vi.fn().mockImplementation((name: string) => {
      const matches: PtySession[] = [];
      for (const s of sessions.values()) {
        if (s.botName === name) matches.push(s);
      }
      matches.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
      return matches;
    }),
    shutdown: vi.fn(),
  };
}

describe("registerTerminalRoutes", () => {
  let routeHandler: (socket: EventEmitter & { readyState: number; OPEN: number; bufferedAmount: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }, req: unknown) => void;
  let ptyManager: ReturnType<typeof createMockPtyManager>;

  const activeSockets: Array<EventEmitter & { close: ReturnType<typeof vi.fn> }> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    ptyManager = createMockPtyManager();
    const mockApp = {
      get: vi.fn().mockImplementation((_path: string, _opts: unknown, handler: typeof routeHandler) => {
        routeHandler = handler;
      }),
    } as unknown as FastifyInstance;

    registerTerminalRoutes(mockApp, ptyManager);
  });

  afterEach(() => {
    // Emit close on all active sockets to clear heartbeat intervals
    for (const s of activeSockets) s.emit("close");
    activeSockets.length = 0;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function createSocket() {
    const emitter = new EventEmitter();
    const socket = Object.assign(emitter, {
      readyState: 1, OPEN: 1, bufferedAmount: 0,
      send: vi.fn(), close: vi.fn(),
      ping: vi.fn(), terminate: vi.fn(),
    });
    activeSockets.push(socket);
    return socket;
  }

  function createReq(name: string, session?: string, cols?: string, rows?: string) {
    return {
      params: { name },
      query: { session, cols, rows },
    };
  }

  it("spawns new PTY and sends session ID with __mecha marker", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));

    expect(ptyManager.spawn).toHaveBeenCalledWith("coder", undefined, 80, 24);
    expect(ptyManager.attach).toHaveBeenCalled();
    const sessionMsg = socket.send.mock.calls.find(([data]: [string]) => {
      try { const m = JSON.parse(data); return m.type === "session" && m.__mecha === true; } catch { return false; }
    });
    expect(sessionMsg).toBeDefined();
  });

  it("sends session ID without botName prefix", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));

    const sessionMsg = socket.send.mock.calls.find(([data]: [string]) => {
      try { return JSON.parse(data).type === "session"; } catch { return false; }
    });
    const parsed = JSON.parse(sessionMsg![0]);
    // Session ID should be just "new-test", not "coder:mock-uuid-1234"
    expect(parsed.id).toBe("mock-uuid-1234");
    expect(parsed.id).not.toContain("coder:");
  });

  it("spawns PTY with client-provided dimensions", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder", undefined, "120", "40"));

    expect(ptyManager.spawn).toHaveBeenCalledWith("coder", undefined, 120, 40);
  });

  it("reattaches to existing session", () => {
    // Pre-populate a session
    const pty = createMockPty();
    const existing: PtySession = { id: "coder:s1", claudeSessionId: "s1", botName: "coder", pty, clients: new Set(), createdAt: new Date(), lastActivity: new Date(), scrollback: [] };
    ptyManager._sessions.set("coder:s1", existing);

    const socket = createSocket();
    routeHandler(socket, createReq("coder", "s1"));

    expect(ptyManager.spawn).not.toHaveBeenCalled();
    expect(ptyManager.attach).toHaveBeenCalledWith("coder:s1", socket);
  });

  it("strips botName: prefix from stale session IDs", () => {
    // Client sends composite key "coder:s1" from stale URL — should be stripped to "s1"
    const pty = createMockPty();
    const existing: PtySession = { id: "coder:s1", claudeSessionId: "s1", botName: "coder", pty, clients: new Set(), createdAt: new Date(), lastActivity: new Date(), scrollback: [] };
    ptyManager._sessions.set("coder:s1", existing);

    const socket = createSocket();
    routeHandler(socket, createReq("coder", "coder:s1"));

    // Should strip "coder:" prefix and look up "coder:s1" (not "coder:coder:s1")
    expect(ptyManager.getSession).toHaveBeenCalledWith("coder:s1");
    expect(ptyManager.spawn).not.toHaveBeenCalled();
  });

  it("falls back to findByBot when no sessionId is provided", () => {
    // Pre-populate a session
    const pty = createMockPty();
    const existing: PtySession = { id: "coder:new-abc123", claudeSessionId: "new-abc123", botName: "coder", pty, clients: new Set(), createdAt: new Date(), lastActivity: new Date(), scrollback: [] };
    ptyManager._sessions.set("coder:new-abc123", existing);

    const socket = createSocket();
    // No session ID — should fallback to findByBot to reuse existing PTY
    routeHandler(socket, createReq("coder"));

    expect(ptyManager.findByBot).toHaveBeenCalledWith("coder");
    expect(ptyManager.spawn).not.toHaveBeenCalled();
    expect(ptyManager.attach).toHaveBeenCalledWith("coder:new-abc123", socket);
  });

  it("spawns new PTY when specific sessionId not found (no findByBot fallback)", () => {
    // Pre-populate a session with a different key
    const pty = createMockPty();
    const existing: PtySession = { id: "coder:new-abc123", claudeSessionId: "new-abc123", botName: "coder", pty, clients: new Set(), createdAt: new Date(), lastActivity: new Date(), scrollback: [] };
    ptyManager._sessions.set("coder:new-abc123", existing);

    const socket = createSocket();
    // Client provides a specific session ID — should NOT fall back to another session
    routeHandler(socket, createReq("coder", "specific-session"));

    // findByBot should NOT be called when a specific sessionId is provided
    expect(ptyManager.findByBot).not.toHaveBeenCalled();
    expect(ptyManager.spawn).toHaveBeenCalled();
  });

  it("replays scrollback on reattach", () => {
    const pty = createMockPty();
    const existing: PtySession = {
      id: "coder:s1", claudeSessionId: "s1", botName: "coder", pty, clients: new Set(),
      createdAt: new Date(), lastActivity: new Date(),
      scrollback: ["chunk1", "chunk2", "chunk3"],
    };
    ptyManager._sessions.set("coder:s1", existing);

    const socket = createSocket();
    routeHandler(socket, createReq("coder", "s1"));

    // Should replay scrollback chunks after the session message
    const calls = socket.send.mock.calls.map(([d]: [string]) => d);
    expect(calls).toContain("chunk1");
    expect(calls).toContain("chunk2");
    expect(calls).toContain("chunk3");
  });

  it("rejects invalid session IDs", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder", "../../../etc/passwd"));

    const errorMsg = socket.send.mock.calls.find(([data]: [string]) => {
      try { const m = JSON.parse(data); return m.type === "error" && m.__mecha === true; } catch { return false; }
    });
    expect(errorMsg).toBeDefined();
    expect(socket.close).toHaveBeenCalledWith(4400, "Invalid session ID");
    expect(ptyManager.spawn).not.toHaveBeenCalled();
  });

  it("sends error on spawn failure with __mecha marker", () => {
    (ptyManager.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("bot not running"); });

    const socket = createSocket();
    routeHandler(socket, createReq("ghost"));

    const errorMsg = socket.send.mock.calls.find(([data]: [string]) => {
      try { const m = JSON.parse(data); return m.type === "error" && m.__mecha === true; } catch { return false; }
    });
    expect(errorMsg).toBeDefined();
    expect(socket.close).toHaveBeenCalledWith(4500, "Spawn failed");
  });

  it("writes binary input to PTY stdin", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));

    const session = (ptyManager.spawn as ReturnType<typeof vi.fn>).mock.results[0].value;
    socket.emit("message", Buffer.from("ls\r"), true);
    expect(session.pty.write).toHaveBeenCalledWith("ls\r");
  });

  it("handles resize message", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));

    socket.emit("message", Buffer.from(JSON.stringify({ type: "resize", cols: 120, rows: 40 })), false);
    expect(ptyManager.resize).toHaveBeenCalledWith("coder:mock-uuid-1234", 120, 40);
  });

  it("sends PTY output as text string", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));

    const session = (ptyManager.spawn as ReturnType<typeof vi.fn>).mock.results[0].value;
    const pty = session.pty as ReturnType<typeof createMockPty>;
    pty._emitData("hello");
    // PTY data sent as text (not binary) to preserve UTF-8 character boundaries
    expect(socket.send).toHaveBeenCalledWith("hello");
  });

  it("sends exit event with __mecha marker when PTY exits", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));

    const session = (ptyManager.spawn as ReturnType<typeof vi.fn>).mock.results[0].value;
    const pty = session.pty as ReturnType<typeof createMockPty>;
    pty._emitExit(0);

    const exitMsg = socket.send.mock.calls.find(([data]: [string]) => {
      try { const m = JSON.parse(data); return m.type === "exit" && m.__mecha === true; } catch { return false; }
    });
    expect(exitMsg).toBeDefined();
    expect(socket.close).toHaveBeenCalledWith(1000, "PTY exited");
  });

  it("detaches on socket close", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));
    socket.emit("close");
    expect(ptyManager.detach).toHaveBeenCalled();
  });

  it("ignores message when session no longer exists", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));

    (ptyManager.getSession as ReturnType<typeof vi.fn>).mockReturnValue(null);
    socket.emit("message", Buffer.from("test"), true);
    // Should not throw
  });

  it("ignores invalid JSON text frames", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));
    socket.emit("message", Buffer.from("not json"), false);
    // Should not throw
  });

  it("ignores non-resize JSON messages", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));
    socket.emit("message", Buffer.from(JSON.stringify({ type: "ping" })), false);
    expect(ptyManager.resize).not.toHaveBeenCalled();
  });

  it("drops output under backpressure", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));

    const session = (ptyManager.spawn as ReturnType<typeof vi.fn>).mock.results[0].value;
    const pty = session.pty as ReturnType<typeof createMockPty>;

    Object.defineProperty(socket, "bufferedAmount", { value: 2_000_000, writable: true });
    const sendCountBefore = socket.send.mock.calls.length;
    pty._emitData("dropped");
    expect(socket.send.mock.calls.length).toBe(sendCountBefore);
  });

  it("does not send when socket is closed", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));

    const session = (ptyManager.spawn as ReturnType<typeof vi.fn>).mock.results[0].value;
    const pty = session.pty as ReturnType<typeof createMockPty>;

    Object.defineProperty(socket, "readyState", { value: 3, writable: true }); // CLOSED
    const sendCountBefore = socket.send.mock.calls.length;
    pty._emitData("not sent");
    expect(socket.send.mock.calls.length).toBe(sendCountBefore);
  });

  it("clamps resize dimensions to safe bounds", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));

    // Send extreme dimensions — should be clamped
    socket.emit("message", Buffer.from(JSON.stringify({ type: "resize", cols: -5, rows: 99999 })), false);
    expect(ptyManager.resize).toHaveBeenCalledWith("coder:mock-uuid-1234", 1, 200);

    // Send fractional dimensions — should be floored
    socket.emit("message", Buffer.from(JSON.stringify({ type: "resize", cols: 120.7, rows: 40.3 })), false);
    expect(ptyManager.resize).toHaveBeenCalledWith("coder:mock-uuid-1234", 120, 40);
  });

  it("rejects invalid bot name", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("../etc/passwd"));

    const errorMsg = socket.send.mock.calls.find(([data]: [string]) => {
      try { const m = JSON.parse(data); return m.type === "error" && m.__mecha === true; } catch { return false; }
    });
    expect(errorMsg).toBeDefined();
    expect(socket.close).toHaveBeenCalledWith(4400, "Invalid bot name");
    expect(ptyManager.spawn).not.toHaveBeenCalled();
  });

  it("heartbeat terminates dead connections", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));

    // First ping — sets isAlive = false
    vi.advanceTimersByTime(30_000);
    expect(socket.ping).toHaveBeenCalledTimes(1);

    // No pong received — next interval should terminate
    vi.advanceTimersByTime(30_000);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });

  it("heartbeat keeps alive when pong received", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));

    // First interval fires ping
    vi.advanceTimersByTime(30_000);
    expect(socket.ping).toHaveBeenCalledTimes(1);

    // Simulate pong
    socket.emit("pong");

    // Next interval should ping again (not terminate)
    vi.advanceTimersByTime(30_000);
    expect(socket.ping).toHaveBeenCalledTimes(2);
    expect(socket.terminate).not.toHaveBeenCalled();
  });

  it("handles socket error without crashing", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));

    // Emitting an error should not throw
    socket.emit("error", new Error("connection reset"));
    expect(ptyManager.detach).toHaveBeenCalled();
  });
});
