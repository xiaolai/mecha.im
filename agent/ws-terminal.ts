import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server as HttpServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PtyManager } from "./pty-manager.js";
import { log } from "../shared/logger.js";

const BACKPRESSURE_LIMIT = 1_048_576; // 1 MB
const PING_INTERVAL_MS = 30_000;
const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;

function makeSessionToken(botToken: string): string {
  return createHmac("sha256", botToken).update("mecha-dashboard-session").digest("hex");
}

/** Verify session cookie from WebSocket upgrade request. */
function verifyAuth(req: IncomingMessage, botToken: string): boolean {
  const cookie = req.headers.cookie;
  if (!cookie) return false;
  const match = cookie.match(/mecha_session=([^;]+)/);
  if (!match) return false;
  const expected = makeSessionToken(botToken);
  const received = Buffer.from(match[1]);
  const expectedBuf = Buffer.from(expected);
  return received.length === expectedBuf.length && timingSafeEqual(received, expectedBuf);
}

/** Attach WebSocket terminal server to an HTTP server. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function attachTerminalWs(
  httpServer: any,
  ptyManager: PtyManager,
  botToken: string,
): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    // Only handle /ws/terminal path
    if (!url.pathname.startsWith("/ws/terminal")) {
      socket.destroy();
      return;
    }

    // Auth check
    if (!verifyAuth(req, botToken)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let sessionId = url.searchParams.get("session") ?? undefined;
    const initCols = Number(url.searchParams.get("cols")) || 80;
    const initRows = Number(url.searchParams.get("rows")) || 24;

    // Validate session ID format
    if (sessionId && !SESSION_ID_RE.test(sessionId)) {
      ws.send(JSON.stringify({ __mecha: true, type: "error", message: `Invalid session ID: ${sessionId}` }));
      ws.close(4400, "Invalid session ID");
      return;
    }

    // Look up existing PTY session
    let session = sessionId ? ptyManager.getSession(sessionId) : null;

    try {
      if (session) {
        const attached = ptyManager.attach(session.id, ws);
        if (!attached) {
          session = ptyManager.spawn(sessionId, initCols, initRows);
          ptyManager.attach(session.id, ws);
        }
      } else {
        session = ptyManager.spawn(sessionId, initCols, initRows);
        ptyManager.attach(session.id, ws);
      }
    } catch (err) {
      ws.send(JSON.stringify({
        __mecha: true,
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      }));
      ws.close(4500, "Spawn failed");
      return;
    }

    const sessionKey = session.id;
    log.info(`Terminal WS connected: session=${sessionKey}`);

    function safeSend(data: string): void {
      if (ws.readyState !== WebSocket.OPEN) return;
      try { ws.send(data); } catch { /* socket closing */ }
    }

    // Send session ID so client can use it for resume
    safeSend(JSON.stringify({ __mecha: true, type: "session", id: session.claudeSessionId }));

    // Replay scrollback
    if (session.scrollback.length > 0) {
      for (const chunk of session.scrollback) {
        safeSend(chunk);
      }
      safeSend("\r\n\x1b[2m--- reconnected ---\x1b[0m\r\n");
    }

    // PTY output → WS (text frames to avoid UTF-8 fragmentation issues)
    const dataDisposable = session.pty.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        if (ws.bufferedAmount > BACKPRESSURE_LIMIT) return;
        safeSend(data);
      }
    });

    // PTY exit → WS
    const exitDisposable = session.pty.onExit(({ exitCode }) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      safeSend(JSON.stringify({ __mecha: true, type: "exit", code: exitCode }));
      ws.close(1000, "PTY exited");
    });

    // WS → PTY
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      const s = ptyManager.getSession(sessionKey);
      if (!s) return;

      const str = data.toString();

      if (!isBinary) {
        try {
          const msg = JSON.parse(str) as { type: string; cols?: number; rows?: number };
          if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
            ptyManager.resize(sessionKey, msg.cols, msg.rows);
            return;
          }
        } catch {
          // Not JSON — treat as PTY input
        }
      }
      s.pty.write(str);
    });

    // Heartbeat
    let isAlive = true;
    ws.on("pong", () => { isAlive = true; });
    const pingTimer = setInterval(() => {
      if (!isAlive) { ws.terminate(); return; }
      isAlive = false;
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, PING_INTERVAL_MS);

    ws.on("error", () => {
      clearInterval(pingTimer);
      ptyManager.detach(sessionKey, ws);
      dataDisposable.dispose();
      exitDisposable.dispose();
    });

    ws.on("close", () => {
      log.info(`Terminal WS disconnected: session=${sessionKey}`);
      clearInterval(pingTimer);
      ptyManager.detach(sessionKey, ws);
      dataDisposable.dispose();
      exitDisposable.dispose();
    });
  });
}
