import type { WebSocket } from "ws";
import type { PtyManager } from "./pty-manager.js";
import { isValidName, type NodeEntry } from "@mecha/core";

const BACKPRESSURE_LIMIT = 1_048_576; // 1 MB

export interface WsHandlerOpts {
  ptyManager: PtyManager;
  /** Resolver for remote nodes — returns node entry or null. */
  getNode?: (name: string) => NodeEntry | undefined;
}

/**
 * Handle a new WebSocket connection for terminal access.
 *
 * URL: /ws/terminal/<casa-name>?session=<id>&node=<name>
 */
export function handleTerminalConnection(
  ws: WebSocket,
  url: URL,
  opts: WsHandlerOpts,
): void {
  const { ptyManager } = opts;

  // Parse URL: /ws/terminal/<casa-name>
  const parts = url.pathname.split("/");
  // Expected: ["", "ws", "terminal", "<casa-name>"]
  if (parts.length < 4 || parts[1] !== "ws" || parts[2] !== "terminal" || !parts[3]) {
    sendError(ws, "Invalid terminal URL");
    ws.close(4400, "Invalid URL");
    return;
  }

  const casaName = parts[3];

  if (!isValidName(casaName)) {
    sendError(ws, "Invalid CASA name");
    ws.close(4400, "Invalid CASA name");
    return;
  }

  const sessionId = url.searchParams.get("session") ?? undefined;
  const node = url.searchParams.get("node") ?? undefined;

  // Remote node relay
  if (node && node !== "local") {
    handleRemoteRelay(ws, casaName, sessionId, node, opts);
    return;
  }

  // Local PTY
  handleLocalPty(ws, casaName, sessionId, ptyManager);
}

function handleLocalPty(
  ws: WebSocket,
  casaName: string,
  sessionId: string | undefined,
  ptyManager: PtyManager,
): void {
  let session = sessionId ? ptyManager.getSession(`${casaName}:${sessionId}`) : null;

  try {
    if (session) {
      // Reattach to existing session
      ptyManager.attach(session.id, ws);
    } else {
      // Spawn new PTY
      session = ptyManager.spawn(casaName, sessionId, 80, 24);
      ptyManager.attach(session.id, ws);
    }
  } catch (err) {
    /* v8 ignore start -- non-Error throw is defensive */
    sendError(ws, err instanceof Error ? err.message : String(err));
    /* v8 ignore stop */
    ws.close(4500, "Spawn failed");
    return;
  }

  const sessionKey = session.id;

  // PTY output → WS (binary)
  const dataDisposable = session.pty.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      if (ws.bufferedAmount > BACKPRESSURE_LIMIT) return; // drop under backpressure
      ws.send(Buffer.from(data), { binary: true });
    }
  });

  // PTY exit → WS
  const exitDisposable = session.pty.onExit(({ exitCode }) => {
    sendJson(ws, { type: "exit", code: exitCode });
    ws.close(1000, "PTY exited");
  });

  // WS → PTY
  ws.on("message", (data, isBinary) => {
    const s = ptyManager.getSession(sessionKey);
    if (!s) return;

    if (isBinary) {
      // Raw keystrokes → PTY stdin
      s.pty.write(data.toString());
    } else {
      // Control frame (JSON)
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

  ws.on("close", () => {
    ptyManager.detach(sessionKey, ws);
    dataDisposable.dispose();
    exitDisposable.dispose();
  });

  // Send session ID to client
  sendJson(ws, { type: "session", id: sessionKey });
}

/* v8 ignore start -- remote relay requires real WS connections; covered by integration tests (WI-3.8) */
function handleRemoteRelay(
  ws: WebSocket,
  casaName: string,
  sessionId: string | undefined,
  nodeName: string,
  opts: WsHandlerOpts,
): void {
  const nodeEntry = opts.getNode?.(nodeName);
  if (!nodeEntry) {
    sendError(ws, `Node "${nodeName}" not found`);
    ws.close(4404, "Node not found");
    return;
  }
  const params = new URLSearchParams();
  if (sessionId) params.set("session", sessionId);
  const query = params.toString();
  const remoteUrl = `ws://${nodeEntry.host}:${nodeEntry.port}/ws/terminal/${casaName}${query ? `?${query}` : ""}`;

  import("ws").then(({ default: WsModule }) => {
    const remote = new WsModule(remoteUrl, [nodeEntry.apiKey], {
      headers: { Authorization: `Bearer ${nodeEntry.apiKey}` },
    });

    remote.on("open", () => {
      ws.on("message", (data, isBinary) => {
        if (remote.readyState === remote.OPEN) {
          remote.send(data, { binary: isBinary });
        }
      });
      remote.on("message", (data, isBinary) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(data, { binary: isBinary });
        }
      });
    });

    ws.on("close", () => {
      if (remote.readyState === remote.OPEN || remote.readyState === remote.CONNECTING) {
        remote.close();
      }
    });

    remote.on("close", () => {
      if (ws.readyState === ws.OPEN) {
        ws.close(1000, "Remote closed");
      }
    });

    remote.on("error", (err) => {
      sendError(ws, `Remote error: ${err.message}`);
      ws.close(4502, "Remote error");
    });
  }).catch((err) => {
    sendError(ws, `Failed to connect: ${err instanceof Error ? err.message : String(err)}`);
    ws.close(4500, "Connection failed");
  });
  /* v8 ignore stop */
}

function sendJson(ws: WebSocket, data: Record<string, unknown>): void {
  /* v8 ignore start -- defensive: WS may close between check and send */
  if (ws.readyState !== ws.OPEN) return;
  /* v8 ignore stop */
  ws.send(JSON.stringify(data));
}

function sendError(ws: WebSocket, message: string): void {
  sendJson(ws, { type: "error", message });
}
