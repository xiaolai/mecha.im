import { useEffect, useRef, useState, useCallback } from "react";
import "@xterm/xterm/css/xterm.css";

const RESIZE_DEBOUNCE_MS = 100;

const DARK_THEME = {
  background: "#111827",
  foreground: "#e0e0e0",
  cursor: "#e0e0e0",
  cursorAccent: "#111827",
  selectionBackground: "rgba(255,255,255,0.2)",
};

interface Props {
  sessionId?: string;
  className?: string;
  onSessionId?: (id: string) => void;
}

export default function TerminalPane({ sessionId, className, onSessionId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [exitCode, setExitCode] = useState<number | null>(null);

  const sendResize = useCallback(() => {
    const ws = wsRef.current;
    const term = termRef.current;
    if (ws?.readyState === WebSocket.OPEN && term) {
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    setStatus("connecting");
    setExitCode(null);

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
            if (text.charAt(0) === "{") {
              try {
                const msg = JSON.parse(text) as {
                  __mecha?: boolean; type: string;
                  id?: string; code?: number; message?: string;
                };
                if (msg.__mecha) {
                  if (msg.type === "session" && msg.id) {
                    onSessionId?.(msg.id);
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
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeObserverRef.current?.disconnect();
      wsRef.current?.close();
      termRef.current?.dispose();
    };
  }, [sessionId, sendResize, onSessionId]);

  return (
    <div className={`flex flex-col ${className ?? ""}`}>
      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-900/80 border-b border-gray-800 text-xs">
        {status === "connecting" && (
          <span className="text-yellow-400">Connecting...</span>
        )}
        {status === "connected" && (
          <span className="text-green-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Terminal connected
          </span>
        )}
        {status === "disconnected" && (
          <span className={exitCode === 0 ? "text-green-400" : "text-red-400"}>
            {exitCode !== null ? `Exited (${exitCode})` : "Disconnected"}
          </span>
        )}
      </div>

      {/* Terminal */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden"
        style={{ padding: "4px" }}
      />
    </div>
  );
}
