import { useEffect, useRef, useState, useCallback } from "react";
import { botFetch } from "../lib/api";
import "@xterm/xterm/css/xterm.css";

const RESIZE_DEBOUNCE_MS = 100;

const DARK_THEME = {
  background: "#111827",
  foreground: "#e0e0e0",
  cursor: "#e0e0e0",
  cursorAccent: "#111827",
  selectionBackground: "rgba(255,255,255,0.2)",
};

interface TaskInfo {
  id: string;
  session_id?: string;
  status: string;
  created: string;
}

export default function TerminalView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "disconnected">("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [sessions, setSessions] = useState<TaskInfo[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | undefined>();
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();

  // Load existing sessions/tasks
  useEffect(() => {
    botFetch("/api/sessions")
      .then((r) => r.json())
      .then((data: TaskInfo[]) => setSessions(data))
      .catch(() => {});
  }, []);

  const sendResize = useCallback(() => {
    const ws = wsRef.current;
    const term = termRef.current;
    if (ws?.readyState === WebSocket.OPEN && term) {
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    }
  }, []);

  const connect = useCallback((sessionId?: string) => {
    if (!containerRef.current) return;

    // Cleanup previous
    wsRef.current?.close();
    termRef.current?.dispose();
    if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    resizeObserverRef.current?.disconnect();

    setStatus("connecting");
    setExitCode(null);
    setActiveSessionId(sessionId);

    let disposed = false;
    let gotExitMessage = false;

    (async () => {
      try {
        const { Terminal: XTerm } = await import("@xterm/xterm");
        const { FitAddon } = await import("@xterm/addon-fit");
        const { WebLinksAddon } = await import("@xterm/addon-web-links");

        if (disposed) return;

        const term = new XTerm({
          cursorBlink: true,
          scrollback: 10_000,
          theme: DARK_THEME,
          fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
          fontSize: 14,
        });

        const fit = new FitAddon();
        term.loadAddon(fit);
        term.loadAddon(new WebLinksAddon());

        term.open(containerRef.current!);
        fit.fit();

        termRef.current = term;
        fitRef.current = fit;

        // Build WebSocket URL
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const params = new URLSearchParams();
        if (sessionId) params.set("session", sessionId);
        params.set("cols", String(term.cols));
        params.set("rows", String(term.rows));
        const query = params.toString();
        const wsUrl = `${proto}//${window.location.host}/ws/terminal${query ? `?${query}` : ""}`;

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (disposed) return;
          setStatus("connected");
          sendResize();
        };

        ws.onmessage = (event: MessageEvent) => {
          if (disposed) return;
          if (event.data instanceof ArrayBuffer) {
            term.write(new Uint8Array(event.data));
          } else {
            const text = event.data as string;
            if (text.startsWith('{"__mecha":true,')) {
              try {
                const msg = JSON.parse(text) as {
                  __mecha?: boolean; type: string;
                  id?: string; code?: number; message?: string;
                };
                if (msg.__mecha) {
                  if (msg.type === "session" && msg.id) {
                    setActiveSessionId(msg.id);
                  } else if (msg.type === "exit") {
                    gotExitMessage = true;
                    setExitCode(typeof msg.code === "number" ? msg.code : -1);
                    setStatus("disconnected");
                  } else if (msg.type === "error") {
                    term.writeln(`\r\n\x1b[31mError: ${msg.message ?? "Unknown error"}\x1b[0m`);
                  }
                  return;
                }
              } catch { /* not valid JSON */ }
            }
            term.write(text);
          }
        };

        ws.onclose = () => {
          if (disposed) return;
          setStatus("disconnected");
          if (!gotExitMessage) {
            term.writeln("\r\n\x1b[2m[Connection closed]\x1b[0m");
          }
        };

        ws.onerror = () => {
          if (disposed) return;
          setStatus("disconnected");
        };

        term.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        });

        const resizeObserver = new ResizeObserver(() => {
          if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
          resizeTimerRef.current = setTimeout(() => {
            if (disposed) return;
            fit.fit();
            sendResize();
          }, RESIZE_DEBOUNCE_MS);
        });
        resizeObserver.observe(containerRef.current!);
        resizeObserverRef.current = resizeObserver;
      } catch {
        if (!disposed) setStatus("disconnected");
      }
    })();

    return () => {
      disposed = true;
    };
  }, [sendResize]);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-lg font-semibold">Terminal</h2>

        {status === "idle" && (
          <>
            <select
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
              value={selectedSession ?? "new"}
              onChange={(e) => setSelectedSession(e.target.value === "new" ? undefined : e.target.value)}
            >
              <option value="new">New Session</option>
              {sessions
                .filter((s) => s.session_id)
                .map((s) => (
                  <option key={s.id} value={s.session_id}>
                    Resume: {s.session_id!.slice(0, 8)}... ({s.status})
                  </option>
                ))}
            </select>
            <button
              onClick={() => connect(selectedSession)}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium"
            >
              Connect
            </button>
          </>
        )}

        {status === "connecting" && (
          <span className="text-yellow-400 text-sm">Connecting...</span>
        )}

        {status === "connected" && (
          <span className="text-green-400 text-sm flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Connected
            {activeSessionId && (
              <span className="text-gray-500 font-mono">
                ({activeSessionId.slice(0, 8)})
              </span>
            )}
          </span>
        )}

        {status === "disconnected" && (
          <div className="flex items-center gap-2">
            <span className={`text-sm ${exitCode === 0 ? "text-green-400" : "text-red-400"}`}>
              {exitCode !== null ? `Exited (${exitCode})` : "Disconnected"}
            </span>
            <button
              onClick={() => connect(activeSessionId)}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs"
            >
              Resume
            </button>
            <button
              onClick={() => {
                setStatus("idle");
                setActiveSessionId(undefined);
              }}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs"
            >
              New Session
            </button>
          </div>
        )}
      </div>

      {/* Terminal container */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 rounded-lg overflow-hidden border border-gray-700 bg-gray-900"
        style={{ padding: status !== "idle" ? "8px" : undefined }}
      >
        {status === "idle" && (
          <div className="flex items-center justify-center h-full text-gray-500">
            <p>Select a session to resume or start a new one</p>
          </div>
        )}
      </div>
    </div>
  );
}
