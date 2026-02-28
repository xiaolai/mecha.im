import type { FastifyInstance } from "fastify";
import type { PtyManager } from "../pty-manager.js";

const BACKPRESSURE_LIMIT = 1_048_576; // 1 MB

export function registerTerminalRoutes(
  app: FastifyInstance,
  ptyManager: PtyManager,
): void {
  app.get("/ws/terminal/:name", { websocket: true }, (socket, req) => {
    const casaName = (req.params as { name: string }).name;
    const sessionId = (req.query as { session?: string }).session ?? undefined;

    let session = sessionId ? ptyManager.getSession(`${casaName}:${sessionId}`) : null;

    try {
      if (session) {
        ptyManager.attach(session.id, socket);
      } else {
        session = ptyManager.spawn(casaName, sessionId, 80, 24);
        ptyManager.attach(session.id, socket);
      }
    } catch (err) {
      socket.send(JSON.stringify({
        type: "error",
        /* v8 ignore start -- non-Error throw guard */
        message: err instanceof Error ? err.message : String(err),
        /* v8 ignore stop */
      }));
      socket.close(4500, "Spawn failed");
      return;
    }

    const sessionKey = session.id;

    // Send session ID
    socket.send(JSON.stringify({ type: "session", id: sessionKey }));

    // PTY output → WS (binary)
    const dataDisposable = session.pty.onData((data) => {
      if (socket.readyState === socket.OPEN) {
        if (socket.bufferedAmount > BACKPRESSURE_LIMIT) return;
        socket.send(Buffer.from(data), { binary: true });
      }
    });

    // PTY exit → WS
    const exitDisposable = session.pty.onExit(({ exitCode }) => {
      /* v8 ignore start -- defensive: socket may close before PTY exits */
      if (socket.readyState !== socket.OPEN) return;
      /* v8 ignore stop */
      socket.send(JSON.stringify({ type: "exit", code: exitCode }));
      socket.close(1000, "PTY exited");
    });

    // WS → PTY
    socket.on("message", (data: Buffer, isBinary: boolean) => {
      const s = ptyManager.getSession(sessionKey);
      if (!s) return;

      if (isBinary) {
        s.pty.write(data.toString());
      } else {
        try {
          const msg = JSON.parse(data.toString()) as { type: string; cols?: number; rows?: number };
          if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
            ptyManager.resize(sessionKey, msg.cols, msg.rows);
          }
        } catch {
          // Invalid JSON — ignore
        }
      }
    });

    socket.on("close", () => {
      ptyManager.detach(sessionKey, socket);
      dataDisposable.dispose();
      exitDisposable.dispose();
    });
  });
}
