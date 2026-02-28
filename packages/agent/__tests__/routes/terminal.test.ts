import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { registerTerminalRoutes } from "../../src/routes/terminal.js";
import type { PtyManager, PtySession } from "../../src/pty-manager.js";
import type { FastifyInstance } from "fastify";
import type { IPty } from "node-pty";

function createMockPty(): IPty & { _emitData: (d: string) => void; _emitExit: (code: number) => void } {
  const emitter = new EventEmitter();
  return {
    pid: 123, cols: 80, rows: 24, process: "claude", handleFlowControl: false,
    onData: (cb: (d: string) => void) => { emitter.on("data", cb); return { dispose: () => emitter.removeListener("data", cb) }; },
    onExit: (cb: (e: { exitCode: number }) => void) => { emitter.on("exit", cb); return { dispose: () => emitter.removeListener("exit", cb) }; },
    write: vi.fn(), resize: vi.fn(), kill: vi.fn(), pause: vi.fn(), resume: vi.fn(), clear: vi.fn(),
    _emitData(d: string) { emitter.emit("data", d); },
    _emitExit(code: number) { emitter.emit("exit", { exitCode: code }); },
  } as unknown as IPty & { _emitData: (d: string) => void; _emitExit: (code: number) => void };
}

function createMockPtyManager(): PtyManager & { _sessions: Map<string, PtySession> } {
  const sessions = new Map<string, PtySession>();
  return {
    _sessions: sessions,
    spawn: vi.fn().mockImplementation((casaName: string, sessionId: string | undefined) => {
      const id = sessionId ? `${casaName}:${sessionId}` : `${casaName}:new-test`;
      const pty = createMockPty();
      const session: PtySession = { id, casaName, pty, clients: new Set(), createdAt: new Date(), lastActivity: new Date() };
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
    shutdown: vi.fn(),
  };
}

describe("registerTerminalRoutes", () => {
  let routeHandler: (socket: EventEmitter & { readyState: number; OPEN: number; bufferedAmount: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }, req: unknown) => void;
  let ptyManager: ReturnType<typeof createMockPtyManager>;

  beforeEach(() => {
    ptyManager = createMockPtyManager();
    const mockApp = {
      get: vi.fn().mockImplementation((_path: string, _opts: unknown, handler: typeof routeHandler) => {
        routeHandler = handler;
      }),
    } as unknown as FastifyInstance;

    registerTerminalRoutes(mockApp, ptyManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createSocket() {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
      readyState: 1, OPEN: 1, bufferedAmount: 0,
      send: vi.fn(), close: vi.fn(),
    });
  }

  function createReq(name: string, session?: string) {
    return {
      params: { name },
      query: { session },
    };
  }

  it("spawns new PTY and sends session ID", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));

    expect(ptyManager.spawn).toHaveBeenCalledWith("coder", undefined, 80, 24);
    expect(ptyManager.attach).toHaveBeenCalled();
    const sessionMsg = socket.send.mock.calls.find(([data]: [string]) => {
      try { return JSON.parse(data).type === "session"; } catch { return false; }
    });
    expect(sessionMsg).toBeDefined();
  });

  it("reattaches to existing session", () => {
    // Pre-populate a session
    const pty = createMockPty();
    const existing: PtySession = { id: "coder:s1", casaName: "coder", pty, clients: new Set(), createdAt: new Date(), lastActivity: new Date() };
    ptyManager._sessions.set("coder:s1", existing);

    const socket = createSocket();
    routeHandler(socket, createReq("coder", "s1"));

    expect(ptyManager.spawn).not.toHaveBeenCalled();
    expect(ptyManager.attach).toHaveBeenCalledWith("coder:s1", socket);
  });

  it("sends error on spawn failure", () => {
    (ptyManager.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("CASA not running"); });

    const socket = createSocket();
    routeHandler(socket, createReq("ghost"));

    const errorMsg = socket.send.mock.calls.find(([data]: [string]) => {
      try { return JSON.parse(data).type === "error"; } catch { return false; }
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
    expect(ptyManager.resize).toHaveBeenCalledWith("coder:new-test", 120, 40);
  });

  it("sends PTY output as binary", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));

    const session = (ptyManager.spawn as ReturnType<typeof vi.fn>).mock.results[0].value;
    const pty = session.pty as ReturnType<typeof createMockPty>;
    pty._emitData("hello");
    expect(socket.send).toHaveBeenCalledWith(expect.any(Buffer), { binary: true });
  });

  it("sends exit event when PTY exits", () => {
    const socket = createSocket();
    routeHandler(socket, createReq("coder"));

    const session = (ptyManager.spawn as ReturnType<typeof vi.fn>).mock.results[0].value;
    const pty = session.pty as ReturnType<typeof createMockPty>;
    pty._emitExit(0);

    const exitMsg = socket.send.mock.calls.find(([data]: [string]) => {
      try { return JSON.parse(data).type === "exit"; } catch { return false; }
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
});
