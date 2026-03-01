"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useTheme } from "next-themes";

interface TerminalProps {
  casaName: string;
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

export function Terminal({ casaName, sessionId, node, onSessionCreated, onExit }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const { resolvedTheme } = useTheme();
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");

  // Store callbacks in refs to avoid triggering effect re-runs
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

  // Main effect: create terminal + WS connection
  // Only re-runs when casaName, sessionId, or node changes (actual navigation)
  useEffect(() => {
    if (!containerRef.current) return;

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

      // Build WebSocket URL
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const params = new URLSearchParams();
      if (sessionId) params.set("session", sessionId);
      if (node && node !== "local") params.set("node", node);
      const query = params.toString();
      const wsUrl = `${proto}//${window.location.host}/ws/terminal/${casaName}${query ? `?${query}` : ""}`;

      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        sendResize();
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(event.data));
        } else {
          try {
            const msg = JSON.parse(event.data as string) as { type: string; id?: string; code?: number; message?: string };
            if (msg.type === "session" && msg.id) {
              onSessionCreatedRef.current?.(msg.id);
            } else if (msg.type === "exit" && typeof msg.code === "number") {
              onExitRef.current?.(msg.code);
              setStatus("disconnected");
            } else if (msg.type === "error") {
              term.writeln(`\r\n\x1b[31mError: ${msg.message ?? "Unknown error"}\x1b[0m`);
            }
          } catch {
            // Non-JSON text — write to terminal
            term.write(event.data as string);
          }
        }
      };

      ws.onclose = () => {
        setStatus("disconnected");
        term.writeln("\r\n\x1b[2m[Connection closed]\x1b[0m");
      };

      ws.onerror = () => {
        setStatus("disconnected");
      };

      // Terminal input → WS (binary)
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(new TextEncoder().encode(data));
        }
      });

      // Resize handling
      const resizeObserver = new ResizeObserver(() => {
        fit.fit();
        sendResize();
      });
      resizeObserver.observe(containerRef.current!);

      return () => {
        resizeObserver.disconnect();
      };
    })();

    return () => {
      disposed = true;
      wsRef.current?.close();
      wsRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- callbacks stored in refs; theme handled separately
  }, [casaName, sessionId, node, sendResize]);

  // Separate effect: update theme without tearing down WS
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
        <div className="absolute top-2 right-2 z-10">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-destructive/15 text-destructive">
            Disconnected
          </span>
        </div>
      )}
      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  );
}
