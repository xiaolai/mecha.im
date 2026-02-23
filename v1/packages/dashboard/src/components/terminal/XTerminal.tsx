"use client";

import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface XTerminalProps {
  mechaId: string;
}

export function XTerminal({ mechaId }: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const execIdRef = useRef<string | null>(null);

  const sendInput = useCallback(
    async (data: string) => {
      const execId = execIdRef.current;
      if (!execId) return;
      try {
        await fetch(`/api/mechas/${mechaId}/terminal/input`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ execId, data }),
        });
      } catch {
        // Connection lost — terminal will show no more output
      }
    },
    [mechaId],
  );

  const sendResize = useCallback(
    async (cols: number, rows: number) => {
      const execId = execIdRef.current;
      if (!execId) return;
      try {
        await fetch(`/api/mechas/${mechaId}/terminal/resize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ execId, cols, rows }),
        });
      } catch {
        // Ignore resize failures
      }
    },
    [mechaId],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const isDark = document.documentElement.classList.contains("dark");

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily:
        "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
      theme: isDark
        ? {
            background: "#1a1a2e",
            foreground: "#e0e0e0",
            cursor: "#e0e0e0",
            selectionBackground: "#3a3a5c",
          }
        : {
            background: "#fafafa",
            foreground: "#1a1a1a",
            cursor: "#1a1a1a",
            selectionBackground: "#d0d0d0",
          },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(el);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Handle user input → send to server
    const inputDisposable = term.onData((data) => {
      sendInput(data);
    });

    // Handle resize → notify server
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      sendResize(cols, rows);
    });

    // Window resize → refit terminal
    const handleWindowResize = () => {
      fitAddon.fit();
    };
    window.addEventListener("resize", handleWindowResize);

    // ResizeObserver for container size changes (panel resizes)
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(el);

    // Start the terminal session
    const abort = new AbortController();
    abortRef.current = abort;

    (async () => {
      try {
        const res = await fetch(`/api/mechas/${mechaId}/terminal`, {
          method: "POST",
          signal: abort.signal,
        });

        if (!res.ok || !res.body) {
          term.writeln(
            `\r\n\x1b[31mFailed to start terminal (${res.status})\x1b[0m`,
          );
          return;
        }

        const reader = res.body.getReader();
        let firstChunk = true;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          if (firstChunk && value) {
            firstChunk = false;
            // First chunk contains \x00<execId>\n followed by optional terminal data
            const nullIdx = value.indexOf(0x00);
            if (nullIdx !== -1) {
              const nlIdx = value.indexOf(0x0a, nullIdx);
              if (nlIdx !== -1) {
                const idBytes = value.slice(nullIdx + 1, nlIdx);
                execIdRef.current = new TextDecoder().decode(idBytes);

                // Send initial resize now that we have the execId
                sendResize(term.cols, term.rows);

                // Write any remaining data after the header
                const rest = value.slice(nlIdx + 1);
                if (rest.length > 0) {
                  term.write(rest);
                }
                continue;
              }
            }
          }

          if (value) {
            term.write(value);
          }
        }

        term.writeln("\r\n\x1b[2m[terminal session ended]\x1b[0m");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        term.writeln("\r\n\x1b[31m[connection lost]\x1b[0m");
      }
    })();

    return () => {
      abort.abort();
      abortRef.current = null;
      execIdRef.current = null;
      inputDisposable.dispose();
      resizeDisposable.dispose();
      window.removeEventListener("resize", handleWindowResize);
      resizeObserver.disconnect();
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [mechaId, sendInput, sendResize]);

  return (
    <div className="size-full min-h-0 px-8 py-1">
      <div ref={containerRef} className="size-full min-h-0" />
    </div>
  );
}
