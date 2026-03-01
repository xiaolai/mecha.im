import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { handleTerminalConnection } from "../src/lib/ws-handler.js";
import type { PtyManager, PtySession } from "../src/lib/pty-manager.js";
import type { WebSocket } from "ws";
import type { MechaPty } from "@mecha/process";

function createMockWs(): WebSocket & EventEmitter & { _sent: Array<{ data: unknown; binary: boolean }> } {
  const emitter = new EventEmitter();
  const ws = Object.assign(emitter, {
    readyState: 1,
    OPEN: 1,
    CONNECTING: 0,
    CLOSING: 2,
    CLOSED: 3,
    bufferedAmount: 0,
    send: vi.fn().mockImplementation(function (this: typeof ws, data: unknown, opts?: { binary?: boolean }) {
      ws._sent.push({ data, binary: opts?.binary ?? false });
    }),
    close: vi.fn(),
    _sent: [] as Array<{ data: unknown; binary: boolean }>,
  });
  return ws as unknown as WebSocket & EventEmitter & { _sent: Array<{ data: unknown; binary: boolean }> };
}

function createMockPty(): MechaPty & { _emitData: (d: string) => void; _emitExit: (code: number) => void } {
  const emitter = new EventEmitter();
  return {
    onData: (cb: (d: string) => void) => {
      emitter.on("data", cb);
      return { dispose: () => emitter.removeListener("data", cb) };
    },
    onExit: (cb: (e: { exitCode: number }) => void) => {
      emitter.on("exit", cb);
      return { dispose: () => emitter.removeListener("exit", cb) };
    },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    _emitData(d: string) { emitter.emit("data", d); },
    _emitExit(code: number) { emitter.emit("exit", { exitCode: code }); },
  } as unknown as MechaPty & { _emitData: (d: string) => void; _emitExit: (code: number) => void };
}

function createMockPtyManager(opts?: { existingSession?: PtySession }): PtyManager {
  const sessions = new Map<string, PtySession>();
  if (opts?.existingSession) {
    sessions.set(opts.existingSession.id, opts.existingSession);
  }
  return {
    spawn: vi.fn().mockImplementation((casaName: string, sessionId: string | undefined) => {
      const id = sessionId ? `${casaName}:${sessionId}` : `${casaName}:new-abc123`;
      const pty = createMockPty();
      const session: PtySession = {
        id,
        casaName,
        pty,
        clients: new Set(),
        createdAt: new Date(),
        lastActivity: new Date(),
      };
      sessions.set(id, session);
      return session;
    }),
    attach: vi.fn().mockImplementation((key: string, ws: WebSocket) => {
      const s = sessions.get(key);
      if (s) s.clients.add(ws);
      return s ?? null;
    }),
    detach: vi.fn().mockImplementation((key: string, ws: WebSocket) => {
      const s = sessions.get(key);
      if (s) s.clients.delete(ws);
    }),
    resize: vi.fn(),
    getSession: vi.fn().mockImplementation((key: string) => sessions.get(key) ?? null),
    listSessions: vi.fn().mockReturnValue([]),
    shutdown: vi.fn(),
  };
}

describe("handleTerminalConnection", () => {
  let ws: ReturnType<typeof createMockWs>;
  let ptyManager: ReturnType<typeof createMockPtyManager>;

  beforeEach(() => {
    ws = createMockWs();
    ptyManager = createMockPtyManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects invalid URL path", () => {
    const url = new URL("http://localhost/ws/invalid");
    handleTerminalConnection(ws, url, { ptyManager });
    expect(ws.close).toHaveBeenCalledWith(4400, "Invalid URL");
  });

  it("rejects non-terminal ws path", () => {
    const url = new URL("http://localhost/ws/other/coder");
    handleTerminalConnection(ws, url, { ptyManager });
    expect(ws.close).toHaveBeenCalledWith(4400, "Invalid URL");
  });

  it("rejects missing casa name", () => {
    const url = new URL("http://localhost/ws/terminal/");
    // parts = ["", "ws", "terminal", ""] — parts[3] is empty string
    handleTerminalConnection(ws, url, { ptyManager });
    expect(ws.close).toHaveBeenCalledWith(4400, "Invalid URL");
  });

  it("spawns new PTY for local connection", () => {
    const url = new URL("http://localhost/ws/terminal/coder");
    handleTerminalConnection(ws, url, { ptyManager });

    expect(ptyManager.spawn).toHaveBeenCalledWith("coder", undefined, 80, 24);
    expect(ptyManager.attach).toHaveBeenCalled();
    // Should send session ID
    const sessionMsg = ws._sent.find(s => {
      try {
        const d = JSON.parse(s.data as string);
        return d.type === "session";
      } catch { return false; }
    });
    expect(sessionMsg).toBeDefined();
  });

  it("reattaches to existing session", () => {
    const mockPty = createMockPty();
    const existingSession: PtySession = {
      id: "coder:sess-1",
      casaName: "coder",
      pty: mockPty,
      clients: new Set(),
      createdAt: new Date(),
      lastActivity: new Date(),
    };
    const pm = createMockPtyManager({ existingSession });

    const url = new URL("http://localhost/ws/terminal/coder?session=sess-1");
    handleTerminalConnection(ws, url, { ptyManager: pm });

    expect(pm.spawn).not.toHaveBeenCalled();
    expect(pm.attach).toHaveBeenCalledWith("coder:sess-1", ws);
  });

  it("sends PTY output as binary frames", () => {
    const url = new URL("http://localhost/ws/terminal/coder");
    handleTerminalConnection(ws, url, { ptyManager });

    // Get the spawned PTY
    const session = (ptyManager.spawn as ReturnType<typeof vi.fn>).mock.results[0].value;
    const pty = session.pty as ReturnType<typeof createMockPty>;

    pty._emitData("hello world");
    expect(ws.send).toHaveBeenCalledWith(expect.any(Buffer), { binary: true });
  });

  it("drops output under backpressure", () => {
    const url = new URL("http://localhost/ws/terminal/coder");
    handleTerminalConnection(ws, url, { ptyManager });

    const session = (ptyManager.spawn as ReturnType<typeof vi.fn>).mock.results[0].value;
    const pty = session.pty as ReturnType<typeof createMockPty>;

    // Simulate backpressure
    Object.defineProperty(ws, "bufferedAmount", { value: 2_000_000, writable: true });
    const sendCountBefore = (ws.send as ReturnType<typeof vi.fn>).mock.calls.length;
    pty._emitData("should be dropped");
    // The session message is already sent, but the data should be dropped
    const sendCountAfter = (ws.send as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(sendCountAfter).toBe(sendCountBefore);
  });

  it("sends exit event when PTY exits", () => {
    const url = new URL("http://localhost/ws/terminal/coder");
    handleTerminalConnection(ws, url, { ptyManager });

    const session = (ptyManager.spawn as ReturnType<typeof vi.fn>).mock.results[0].value;
    const pty = session.pty as ReturnType<typeof createMockPty>;

    pty._emitExit(0);
    const exitMsg = ws._sent.find(s => {
      try {
        const d = JSON.parse(s.data as string);
        return d.type === "exit";
      } catch { return false; }
    });
    expect(exitMsg).toBeDefined();
    expect(ws.close).toHaveBeenCalledWith(1000, "PTY exited");
  });

  it("writes binary input to PTY stdin", () => {
    const url = new URL("http://localhost/ws/terminal/coder");
    handleTerminalConnection(ws, url, { ptyManager });

    const session = (ptyManager.spawn as ReturnType<typeof vi.fn>).mock.results[0].value;
    const pty = session.pty as MechaPty;

    ws.emit("message", Buffer.from("ls\r"), true);
    expect(pty.write).toHaveBeenCalledWith("ls\r");
  });

  it("handles JSON resize message", () => {
    const url = new URL("http://localhost/ws/terminal/coder");
    handleTerminalConnection(ws, url, { ptyManager });

    ws.emit("message", Buffer.from(JSON.stringify({ type: "resize", cols: 120, rows: 40 })), false);
    expect(ptyManager.resize).toHaveBeenCalledWith("coder:new-abc123", 120, 40);
  });

  it("ignores non-resize JSON text frames", () => {
    const url = new URL("http://localhost/ws/terminal/coder");
    handleTerminalConnection(ws, url, { ptyManager });

    // Valid JSON but not a resize message — should not throw or resize
    ws.emit("message", Buffer.from(JSON.stringify({ type: "ping" })), false);
    expect(ptyManager.resize).not.toHaveBeenCalled();
  });

  it("ignores invalid JSON text frames", () => {
    const url = new URL("http://localhost/ws/terminal/coder");
    handleTerminalConnection(ws, url, { ptyManager });

    // Should not throw
    ws.emit("message", Buffer.from("not json"), false);
  });

  it("does not send PTY output when WS is closed", () => {
    const url = new URL("http://localhost/ws/terminal/coder");
    handleTerminalConnection(ws, url, { ptyManager });

    const session = (ptyManager.spawn as ReturnType<typeof vi.fn>).mock.results[0].value;
    const pty = session.pty as ReturnType<typeof createMockPty>;

    // Simulate WS closed
    Object.defineProperty(ws, "readyState", { value: 3, writable: true }); // CLOSED
    const sendCountBefore = (ws.send as ReturnType<typeof vi.fn>).mock.calls.length;
    pty._emitData("should not be sent");
    expect((ws.send as ReturnType<typeof vi.fn>).mock.calls.length).toBe(sendCountBefore);
  });

  it("ignores message when session no longer exists", () => {
    const url = new URL("http://localhost/ws/terminal/coder");
    handleTerminalConnection(ws, url, { ptyManager });

    // Make getSession return null (PTY exited)
    (ptyManager.getSession as ReturnType<typeof vi.fn>).mockReturnValue(null);
    // Should not throw
    ws.emit("message", Buffer.from("ls\r"), true);
  });

  it("detaches on WS close", () => {
    const url = new URL("http://localhost/ws/terminal/coder");
    handleTerminalConnection(ws, url, { ptyManager });

    ws.emit("close");
    expect(ptyManager.detach).toHaveBeenCalled();
  });

  it("sends error and closes on spawn failure", () => {
    (ptyManager.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("CASA not running");
    });

    const url = new URL("http://localhost/ws/terminal/coder");
    handleTerminalConnection(ws, url, { ptyManager });

    const errorMsg = ws._sent.find(s => {
      try {
        const d = JSON.parse(s.data as string);
        return d.type === "error";
      } catch { return false; }
    });
    expect(errorMsg).toBeDefined();
    expect(ws.close).toHaveBeenCalledWith(4500, "Spawn failed");
  });

  describe("remote relay", () => {
    it("rejects unknown node", () => {
      const url = new URL("http://localhost/ws/terminal/coder?node=ghost");
      handleTerminalConnection(ws, url, {
        ptyManager,
        getNode: () => undefined,
      });

      const errorMsg = ws._sent.find(s => {
        try {
          const d = JSON.parse(s.data as string);
          return d.type === "error" && d.message.includes("ghost");
        } catch { return false; }
      });
      expect(errorMsg).toBeDefined();
      expect(ws.close).toHaveBeenCalledWith(4404, "Node not found");
    });

    it("treats node=local as local connection", () => {
      const url = new URL("http://localhost/ws/terminal/coder?node=local");
      handleTerminalConnection(ws, url, { ptyManager });
      expect(ptyManager.spawn).toHaveBeenCalled();
    });
  });
});
