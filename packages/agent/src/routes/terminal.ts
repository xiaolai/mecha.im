import type { FastifyInstance } from "fastify";
import { isValidName } from "@mecha/core";
import type { PtyManager } from "../pty-manager.js";

const BACKPRESSURE_LIMIT = 1_048_576; // 1 MB
const PING_INTERVAL_MS = 30_000; // 30s heartbeat

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

    // Reject remote terminal requests — WS proxying not yet supported
    /* v8 ignore start -- query param extraction fallback */
    const nodeParam = (req.query as { node?: string } | undefined)?.node
      ?? new URL(rawUrl || "/", "http://localhost").searchParams.get("node")
      ?? undefined;
    /* v8 ignore stop */
    if (nodeParam && nodeParam !== "local") {
      socket.send(JSON.stringify({
        __mecha: true, type: "error",
        message: "Remote terminals are not supported yet. Use SSH to access the remote node directly.",
      }));
      socket.close(4400, "Remote terminal not supported");
      return;
    }

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

    // Validate session ID format (UUIDs, legacy new-* IDs, alphanumeric)
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
        const attached = ptyManager.attach(session.id, socket);
        /* v8 ignore start -- race: session vanished between lookup and attach */
        if (!attached) {
          session = ptyManager.spawn(botName, sessionId, initCols, initRows);
          ptyManager.attach(session.id, socket);
        }
        /* v8 ignore stop */
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

    /** Send helper: guards against readyState + swallows broken-socket throws. */
    function safeSend(data: string): void {
      /* v8 ignore start -- defensive: socket can break between check and send */
      if (socket.readyState !== socket.OPEN) return;
      try { socket.send(data); } catch { /* socket closing — ignore */ }
      /* v8 ignore stop */
    }

    // Send the real Claude Code session ID so the client can use it for --resume
    safeSend(JSON.stringify({ __mecha: true, type: "session", id: session.claudeSessionId }));

    // Replay scrollback buffer so reattaching clients see recent output
    if (session.scrollback.length > 0) {
      for (const chunk of session.scrollback) {
        safeSend(chunk);
      }
      // Visual separator so user can distinguish replayed output from new output
      safeSend("\r\n\x1b[2m--- reconnected ---\x1b[0m\r\n");
    }

    // PTY output → WS (text)
    // Send as text string — the PTY onData callback already delivers properly
    // decoded strings (via streaming TextDecoder). Sending as binary would
    // re-encode to UTF-8 bytes, but if xterm.js receives partial multi-byte
    // sequences across WebSocket frames it renders U+FFFD replacement chars.
    const dataDisposable = session.pty.onData((data) => {
      if (socket.readyState === socket.OPEN) {
        if (socket.bufferedAmount > BACKPRESSURE_LIMIT) return;
        safeSend(data);
      }
    });

    // PTY exit → WS
    const exitDisposable = session.pty.onExit(({ exitCode }) => {
      /* v8 ignore start -- defensive: socket may close before PTY exits */
      if (socket.readyState !== socket.OPEN) return;
      /* v8 ignore stop */
      safeSend(JSON.stringify({ __mecha: true, type: "exit", code: exitCode }));
      socket.close(1000, "PTY exited");
    });

    // WS → PTY
    socket.on("message", (data: Buffer, isBinary: boolean) => {
      const s = ptyManager.getSession(sessionKey);
      if (!s) return;

      const str = data.toString();

      if (isBinary) {
        s.pty.write(str);
      } else {
        try {
          const msg = JSON.parse(str) as { type: string; cols?: number; rows?: number };
          if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
            const cols = Math.max(1, Math.min(500, Math.floor(msg.cols)));
            const rows = Math.max(1, Math.min(200, Math.floor(msg.rows)));
            ptyManager.resize(sessionKey, cols, rows);
            return;
          }
        } catch {
          // Not JSON — treat as PTY input below
        }
        s.pty.write(str);
      }
    });

    // Heartbeat: detect dead connections (e.g. network drop without FIN)
    let isAlive = true;
    socket.on("pong", () => { isAlive = true; });
    const pingTimer = setInterval(() => {
      if (!isAlive) { socket.terminate(); return; }
      isAlive = false;
      if (socket.readyState === socket.OPEN) socket.ping();
    }, PING_INTERVAL_MS);

    // Prevent unhandled WebSocket errors from crashing the process
    /* v8 ignore start -- WS errors are rare and hard to reproduce in tests */
    socket.on("error", () => {
      clearInterval(pingTimer);
      ptyManager.detach(sessionKey, socket);
      dataDisposable.dispose();
      exitDisposable.dispose();
    });
    /* v8 ignore stop */

    socket.on("close", () => {
      clearInterval(pingTimer);
      ptyManager.detach(sessionKey, socket);
      dataDisposable.dispose();
      exitDisposable.dispose();
    });
  });
}
