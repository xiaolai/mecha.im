import { useState, useEffect, useRef, useCallback } from "react";
import { botFetch } from "../lib/api";

interface LogEntry {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

export default function EventLog() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const r = await botFetch("/api/logs?limit=100");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (Array.isArray(data)) setLogs((data as LogEntry[]).reverse());
    } catch (err) {
      console.error("Log fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs(true);
    intervalRef.current = setInterval(() => fetchLogs(), 10_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchLogs]);

  const eventTypes = Array.from(new Set(logs.map((l) => l.type))).sort();
  const filtered = filter ? logs.filter((l) => l.type === filter) : logs;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-foreground">Event Log</h2>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-background border border-border rounded-md px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All</option>
            {eventTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button
            onClick={() => fetchLogs(true)}
            className="text-sm bg-secondary hover:bg-secondary/80 text-secondary-foreground px-3 py-1 rounded-md transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>
      <div className="space-y-1 font-mono text-sm max-h-96 overflow-y-auto scrollbar-thin">
        {loading && <p className="text-muted-foreground">Loading...</p>}
        {!loading && filtered.length === 0 && <p className="text-muted-foreground">No events</p>}
        {!loading && filtered.map((entry, i) => (
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
  );
}
