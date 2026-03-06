import type { FastifyInstance } from "fastify";
import { isValidName } from "@mecha/core";
import type { PtyManager } from "../pty-manager.js";

const BACKPRESSURE_LIMIT = 1_048_576; // 1 MB

/** Only allow alphanumeric, hyphens, and underscores in session IDs. */
const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;

/** Register WebSocket /ws/terminal/:name for interactive PTY terminal sessions. */
export function registerTerminalRoutes(
  app: FastifyInstance,
  ptyManager: PtyManager,
): void {
  app.get("/ws/terminal/:name", { websocket: true }, (socket, req) => {
    // @fastify/websocket v11: req may lack params/url in some runtimes.
    // Use raw request URL as fallback for robust param extraction.
    /* v8 ignore start -- fallback branches for runtimes where req.url/params are missing */
    const rawUrl = req.url ?? req.raw?.url ?? "";
    const botName = (req.params as { name?: string } | undefined)?.name
      ?? rawUrl.match(/\/ws\/terminal\/([^/?]+)/)?.[1]
      ?? "";
    let sessionId = (req.query as { session?: string } | undefined)?.session
      ?? new URL(rawUrl || "/", "http://localhost").searchParams.get("session")
      ?? undefined;
    /* v8 ignore stop */

    // Validate bot name consistently with other routes
    if (!botName || !isValidName(botName)) {
      socket.send(JSON.stringify({ __mecha: true, type: "error", message: `Invalid bot name: ${botName}` }));
      socket.close(4400, "Invalid bot name");
      return;
    }

    // Defensive: strip botName: prefix if client sent composite key from stale URL
    if (sessionId?.startsWith(`${botName}:`)) {
      sessionId = sessionId.slice(botName.length + 1);
    }

    // Validate session ID format (allow new-* mecha-internal IDs)
    if (sessionId && !SESSION_ID_RE.test(sessionId)) {
      socket.send(JSON.stringify({
        __mecha: true, type: "error",
        message: `Invalid session ID: ${sessionId}`,
      }));
      socket.close(4400, "Invalid session ID");
      return;
    }

    // Use client-provided initial dimensions to avoid size mismatch artifacts.
    /* v8 ignore start -- fallback for missing query params */
    const queryObj = (req.query as { cols?: string; rows?: string } | undefined) ?? {};
    const parsedUrl = new URL(rawUrl || "/", "http://localhost");
    const initCols = Number(queryObj.cols ?? parsedUrl.searchParams.get("cols")) || 80;
    const initRows = Number(queryObj.rows ?? parsedUrl.searchParams.get("rows")) || 24;
    /* v8 ignore stop */

    // Look up existing PTY: try exact key first, then fall back to findByBot
    // ONLY when no specific sessionId was requested (prevents cross-session leaks).
    let session = sessionId ? ptyManager.getSession(`${botName}:${sessionId}`) : null;
    if (!session && !sessionId) {
      const botSessions = ptyManager.findByBot(botName);
      if (botSessions.length > 0) session = botSessions[0] ?? null;
    }

    try {
      if (session) {
        ptyManager.attach(session.id, socket);
      } else {
        session = ptyManager.spawn(botName, sessionId, initCols, initRows);
        ptyManager.attach(session.id, socket);
      }
    } catch (err) {
      socket.send(JSON.stringify({
        __mecha: true,
        type: "error",
        /* v8 ignore start -- non-Error throw guard */
        message: err instanceof Error ? err.message : String(err),
        /* v8 ignore stop */
      }));
      socket.close(4500, "Spawn failed");
      return;
    }

    const sessionKey = session.id;

    // Send session ID — strip botName: prefix so client stores only the session part
    const clientSessionId = sessionKey.startsWith(`${botName}:`)
      ? sessionKey.slice(botName.length + 1)
      : sessionKey;
    socket.send(JSON.stringify({ __mecha: true, type: "session", id: clientSessionId }));

    // Replay scrollback buffer so reattaching clients see recent output
    for (const chunk of session.scrollback) {
      if (socket.readyState === socket.OPEN) socket.send(chunk);
    }

    // PTY output → WS (text)
    // Send as text string — the PTY onData callback already delivers properly
    // decoded strings (via streaming TextDecoder). Sending as binary would
    // re-encode to UTF-8 bytes, but if xterm.js receives partial multi-byte
    // sequences across WebSocket frames it renders U+FFFD replacement chars.
    const dataDisposable = session.pty.onData((data) => {
      if (socket.readyState === socket.OPEN) {
        if (socket.bufferedAmount > BACKPRESSURE_LIMIT) return;
        socket.send(data);
      }
    });

    // PTY exit → WS
    const exitDisposable = session.pty.onExit(({ exitCode }) => {
      /* v8 ignore start -- defensive: socket may close before PTY exits */
      if (socket.readyState !== socket.OPEN) return;
      /* v8 ignore stop */
      socket.send(JSON.stringify({ __mecha: true, type: "exit", code: exitCode }));
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
            const cols = Math.max(1, Math.min(500, Math.floor(msg.cols)));
            const rows = Math.max(1, Math.min(200, Math.floor(msg.rows)));
            ptyManager.resize(sessionKey, cols, rows);
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
