"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";

interface ExecResult {
  exitCode: number;
  output: string;
}

const MAX_DISPLAY_LEN = 100_000;

export function MechaExec({ mechaId }: { mechaId: string }) {
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Array<{ cmd: string; result: ExecResult; ts: number }>>([]);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  const runCommand = useCallback(async () => {
    const cmd = command.trim();
    if (!cmd) return;
    setRunning(true);
    setError("");
    try {
      const res = await fetch(`/api/mechas/${mechaId}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: ["/bin/sh", "-c", cmd] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? `Error ${res.status}`);
        return;
      }
      const result = await res.json() as ExecResult;
      setResults((prev) => [...prev, { cmd, result, ts: Date.now() }]);
      setHistory((prev) => {
        const next = prev.filter((h) => h !== cmd);
        next.unshift(cmd);
        return next.slice(0, 10);
      });
      setCommand("");
      setHistoryIdx(-1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute");
    } finally {
      setRunning(false);
    }
  }, [mechaId, command]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !running) {
      runCommand();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHistoryIdx((prev) => {
        const next = Math.min(prev + 1, history.length - 1);
        if (next >= 0 && history[next]) setCommand(history[next]);
        return next;
      });
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHistoryIdx((prev) => {
        const next = prev - 1;
        if (next < 0) {
          setCommand("");
          return -1;
        }
        if (history[next]) setCommand(history[next]);
        return next;
      });
    }
  }, [running, runCommand, history]);

  return (
    <div>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter command (e.g., ls -la)"
          disabled={running}
          className="flex-1 px-2.5 py-1.5 text-sm font-mono rounded border border-border bg-background text-foreground outline-none"
        />
        <Button
          onClick={runCommand}
          disabled={running || !command.trim()}
          size="sm"
        >
          {running ? "Running..." : "Run"}
        </Button>
      </div>
      {error && (
        <p className="text-sm text-destructive mb-2">{error}</p>
      )}
      {results.length > 0 && (
        <div className="p-3 bg-background border border-border rounded-md max-h-96 overflow-auto font-mono text-xs">
          {results.map((r) => (
            <div key={r.ts} className="mb-3">
              <div className="text-accent-foreground mb-1">
                $ {r.cmd}
              </div>
              <pre className={`m-0 whitespace-pre-wrap break-all ${
                r.result.exitCode === 0 ? "text-foreground" : "text-destructive"
              }`}>
                {r.result.output.length > MAX_DISPLAY_LEN
                  ? r.result.output.slice(0, MAX_DISPLAY_LEN) + "\n... (output truncated)"
                  : r.result.output || "(no output)"}
              </pre>
              {r.result.exitCode !== 0 && (
                <div className="text-warning text-xs mt-0.5">
                  exit code: {r.result.exitCode}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
