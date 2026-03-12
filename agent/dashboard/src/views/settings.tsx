import { useState, useEffect } from "react";
import { botFetch } from "../lib/api";

interface LogEntry {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

export default function Settings() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [costs, setCosts] = useState<Record<string, unknown> | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    Promise.all([
      botFetch("/api/config").then((r) => r.json()),
      botFetch("/api/status").then((r) => r.json()),
      botFetch("/api/costs").then((r) => r.json()),
      botFetch("/api/logs?limit=100").then((r) => r.json()),
    ]).then(([c, s, co, l]) => {
      setConfig(c);
      setStatus(s);
      setCosts(co);
      setLogs((l as LogEntry[]).reverse());
    }).catch((err) => console.error("Settings fetch error:", err));
  }, []);

  function refreshLogs() {
    botFetch("/api/logs?limit=100")
      .then((r) => r.json())
      .then((data) => setLogs((data as LogEntry[]).reverse()))
      .catch((err) => console.error("Log refresh error:", err));
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Status */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Status</h2>
        {status && (
          <div className="bg-card rounded-lg border border-border p-4 font-mono text-sm text-foreground">
            <pre>{JSON.stringify(status, null, 2)}</pre>
          </div>
        )}
      </section>

      {/* Costs */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Costs</h2>
        {costs && (
          <div className="grid grid-cols-3 gap-4">
            {Object.entries(costs).map(([k, v]) => (
              <div key={k} className="bg-card rounded-lg border border-border p-4 text-center">
                <div className="text-2xl font-bold text-foreground">${typeof v === "number" ? v.toFixed(4) : String(v)}</div>
                <div className="text-muted-foreground text-sm mt-1">{k}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Configuration */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Configuration</h2>
        {config && (
          <div className="bg-card rounded-lg border border-border p-4 font-mono text-sm text-foreground">
            <pre>{JSON.stringify(config, null, 2)}</pre>
          </div>
        )}
      </section>

      {/* Event Log */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-foreground">Event Log</h2>
          <button
            onClick={refreshLogs}
            className="text-sm bg-secondary hover:bg-secondary/80 text-secondary-foreground px-3 py-1 rounded-md transition-colors"
          >
            Refresh
          </button>
        </div>
        <div className="space-y-1 font-mono text-sm max-h-96 overflow-y-auto scrollbar-thin">
          {logs.length === 0 && <p className="text-muted-foreground">No events</p>}
          {logs.map((entry, i) => (
            <div key={`${entry.timestamp}-${entry.type}-${i}`} className="flex gap-3 py-1 border-b border-border/50">
              <span className="text-muted-foreground shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span
                className={`shrink-0 ${
                  entry.type === "mecha_call"
                    ? "text-primary"
                    : entry.type === "error"
                      ? "text-destructive"
                      : "text-muted-foreground"
                }`}
              >
                {entry.type}
              </span>
              <span className="text-foreground truncate">
                {Object.entries(entry)
                  .filter(([k]) => k !== "type" && k !== "timestamp")
                  .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                  .join(" ")}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
