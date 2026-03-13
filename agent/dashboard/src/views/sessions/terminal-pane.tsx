import { useEffect, useRef, useState, useCallback } from "react";
import { botUrl } from "../../lib/api";
import { parseWsMessage } from "../../lib/ws-parse";
import "@xterm/xterm/css/xterm.css";

const isMock = import.meta.env.VITE_MOCK === "true" || import.meta.env.VITE_MOCK === true;

const RESIZE_DEBOUNCE_MS = 100;

function getTerminalTheme(): Record<string, string> {
  const isDark = document.documentElement.classList.contains("dark");
  if (isDark) {
    return {
      background: "#0a0a0f",
      foreground: "#e0e0e0",
      cursor: "#e0e0e0",
      cursorAccent: "#0a0a0f",
      selectionBackground: "rgba(255,255,255,0.15)",
      // ANSI colors (dark theme — bright, vibrant on dark bg)
      black: "#1a1a2e",
      red: "#f87171",
      green: "#4ade80",
      yellow: "#facc15",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#22d3ee",
      white: "#e0e0e0",
      brightBlack: "#6b7280",
      brightRed: "#fca5a5",
      brightGreen: "#86efac",
      brightYellow: "#fde68a",
      brightBlue: "#93c5fd",
      brightMagenta: "#d8b4fe",
      brightCyan: "#67e8f9",
      brightWhite: "#ffffff",
    };
  }
  return {
    background: "#fafafa",
    foreground: "#1a1a2e",
    cursor: "#1a1a2e",
    cursorAccent: "#fafafa",
    selectionBackground: "rgba(0,0,0,0.12)",
    // ANSI colors (light theme — darker, high-contrast on light bg)
    black: "#1a1a2e",
    red: "#dc2626",
    green: "#16a34a",
    yellow: "#ca8a04",
    blue: "#2563eb",
    magenta: "#9333ea",
    cyan: "#0891b2",
    white: "#e5e7eb",
    brightBlack: "#6b7280",
    brightRed: "#b91c1c",
    brightGreen: "#15803d",
    brightYellow: "#a16207",
    brightBlue: "#1d4ed8",
    brightMagenta: "#7e22ce",
    brightCyan: "#0e7490",
    brightWhite: "#f9fafb",
  };
}

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

  // Sync xterm theme with document dark/light class
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const term = termRef.current;
      if (term) {
        term.options.theme = getTerminalTheme();
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    setExitCode(null);

    // In mock mode, no WebSocket server is available
    if (isMock) {
      setStatus("disconnected");
      return;
    }

    setStatus("connecting");

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
          theme: getTerminalTheme(),
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
        const wsPath = botUrl(`/ws/terminal${query ? `?${query}` : ""}`);
        const wsUrl = `${proto}//${window.location.host}${wsPath}`;

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
          const parsed = parseWsMessage(event.data);
          switch (parsed.kind) {
            case "binary":
              term.write(parsed.data);
              break;
            case "text":
              term.write(parsed.data);
              break;
            case "mecha-session":
              onSessionId?.(parsed.id);
              break;
            case "mecha-exit":
              gotExitMessage = true;
              setExitCode(parsed.code);
              setStatus("disconnected");
              break;
            case "mecha-error":
              term.writeln(`\r\n\x1b[31mError: ${parsed.message}\x1b[0m`);
              break;
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

  // Mock mode: show centered placeholder instead of terminal
  if (isMock) {
    return (
      <div className={`flex flex-col ${className ?? ""}`}>
        <div className="flex-1 flex items-center justify-center bg-muted/30">
          <div className="text-center space-y-2">
            <div className="text-muted-foreground text-sm">Terminal not available in mock mode</div>
            <div className="text-muted-foreground/60 text-xs">Connect to a live Mecha server to use the terminal</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${className ?? ""}`}>
      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-card border-b border-border text-xs">
        {status === "connecting" && (
          <span className="text-warning">Connecting...</span>
        )}
        {status === "connected" && (
          <span className="text-success flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            Terminal connected
          </span>
        )}
        {status === "disconnected" && (
          <span className={exitCode === 0 ? "text-success" : "text-destructive"}>
            {exitCode !== null ? `Exited (${exitCode})` : "Disconnected"}
          </span>
        )}
      </div>

      {/* Terminal */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden bg-background"
        style={{ padding: "4px" }}
      />
    </div>
  );
}
