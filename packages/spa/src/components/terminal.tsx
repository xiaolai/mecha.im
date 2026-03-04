import { useEffect, useRef, useCallback, useState } from "react";
import { useTheme } from "next-themes";
import { useAuth } from "@/auth-context";

// xterm.js CSS — required for correct layout, cursor, selection, and scrollbar rendering.
// Without this import the terminal renders with broken positioning and no scrollbar.
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  botName: string;
  sessionId?: string;
  node?: string;
  onSessionCreated?: (id: string) => void;
  onExit?: (code: number) => void;
}

const DARK_THEME = {
  background: "#1a1a1a",
  foreground: "#e0e0e0",
  cursor: "#e0e0e0",
  cursorAccent: "#1a1a1a",
  selectionBackground: "rgba(255,255,255,0.2)",
};

const LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#1a1a1a",
  cursor: "#1a1a1a",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(0,0,0,0.1)",
};

/** Debounce resize events to prevent excessive fit/resize calls. */
const RESIZE_DEBOUNCE_MS = 100;

/** Reuse one encoder for all keystroke sends to avoid per-keystroke allocation. */
const textEncoder = new TextEncoder();

export function Terminal({ botName, sessionId, node, onSessionCreated, onExit }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { resolvedTheme } = useTheme();
  const { authHeaders } = useAuth();
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);

  const onSessionCreatedRef = useRef(onSessionCreated);
  onSessionCreatedRef.current = onSessionCreated;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

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

    (async () => {
      const { Terminal: XTerm } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      if (disposed) return;

      const term = new XTerm({
        cursorBlink: true,
        scrollback: 10_000,
        theme: resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME,
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

      // Obtain a short-lived ticket for WS auth (avoids putting API key in URL)
      let ticket: string | undefined;
      try {
        const ticketRes = await fetch("/ws/ticket", { method: "POST", headers: authHeaders });
        if (ticketRes.ok) {
          const data = await ticketRes.json() as { ticket: string };
          ticket = data.ticket;
        } else if (ticketRes.status === 401) {
          setStatus("disconnected");
          term.writeln("\r\n\x1b[31mAuthentication expired. Please re-login.\x1b[0m");
          return;
        }
      } catch { /* proceed without ticket — server will reject if required */ }
      if (disposed) return;

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const params = new URLSearchParams();
      if (sessionId) params.set("session", sessionId);
      if (node && node !== "local") params.set("node", node);
      if (ticket) params.set("ticket", ticket);
      // Send initial terminal dimensions so the PTY spawns at the correct size,
      // avoiding garbled output from the spinner rendering at wrong dimensions.
      params.set("cols", String(term.cols));
      params.set("rows", String(term.rows));
      const query = params.toString();
      const wsUrl = `${proto}//${window.location.host}/ws/terminal/${encodeURIComponent(botName)}${query ? `?${query}` : ""}`;

      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        setStatus("connected");
        sendResize();
      };

      ws.onmessage = (event: MessageEvent) => {
        if (disposed) return;
        if (event.data instanceof ArrayBuffer) {
          // Legacy binary frames (should not occur with current server)
          term.write(new Uint8Array(event.data));
        } else {
          const text = event.data as string;
          // Only parse as control message if it starts with our exact framing prefix.
          // PTY output cannot accidentally match this exact prefix + valid JSON
          // with __mecha: true, making spoofing impractical.
          if (text.startsWith('{"__mecha":true,')) {
            try {
              const msg = JSON.parse(text) as { __mecha?: boolean; type: string; id?: string; code?: number; message?: string };
              if (msg.__mecha) {
                if (msg.type === "session" && msg.id) {
                  onSessionCreatedRef.current?.(msg.id);
                } else if (msg.type === "exit" && typeof msg.code === "number") {
                  setExitCode(msg.code);
                  onExitRef.current?.(msg.code);
                  setStatus("disconnected");
                } else if (msg.type === "error") {
                  term.writeln(`\r\n\x1b[31mError: ${msg.message ?? "Unknown error"}\x1b[0m`);
                }
                return;
              }
            } catch { /* not valid JSON — write as terminal data */ }
          }
          term.write(text);
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setStatus("disconnected");
        term.writeln("\r\n\x1b[2m[Connection closed]\x1b[0m");
      };

      ws.onerror = () => {
        if (disposed) return;
        setStatus("disconnected");
      };

      // Use onData for terminal input — xterm.js handles IME composition internally
      // and only fires onData with the final committed text, not intermediate composition.
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(textEncoder.encode(data));
        }
      });

      // Debounced resize observer — prevents excessive fit/resize calls during
      // continuous resizing (e.g. dragging window edge).
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
    })();

    return () => {
      disposed = true;
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  // sessionId intentionally excluded — it's only used for the initial connection.
  // Including it would cause an infinite loop: server returns session ID → parent
  // updates state → effect re-runs → spawns new PTY → repeat.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botName, node, sendResize, authHeaders, reconnectKey]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME;
  }, [resolvedTheme]);

  return (
    <div className="relative flex flex-col h-full">
      {status === "connecting" && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <span className="text-sm text-muted-foreground">Connecting...</span>
        </div>
      )}
      {status === "disconnected" && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
            exitCode === 0
              ? "bg-success/15 text-success"
              : "bg-destructive/15 text-destructive"
          }`}>
            {exitCode !== null ? `Exited (${exitCode})` : "Disconnected"}
          </span>
          <button
            onClick={() => setReconnectKey((k) => k + 1)}
            className="h-7 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent"
          >
            Reconnect
          </button>
        </div>
      )}
      <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden [&_.xterm-screen]:pl-4" />
    </div>
  );
}
