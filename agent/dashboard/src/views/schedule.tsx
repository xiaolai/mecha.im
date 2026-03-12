import { useState, useEffect } from "react";
import { botFetch } from "../lib/api";

interface ScheduleEntry {
  id: string;
  cron: string;
  prompt: string;
  status: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastResult: string | null;
  runsToday: number;
  consecutiveErrors: number;
}

export default function Schedule() {
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    botFetch("/api/schedule")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load schedule"));
  }, []);

  async function trigger(id: string) {
    try {
      const tr = await botFetch(`/api/schedule/trigger/${encodeURIComponent(id)}`, { method: "POST" });
      if (!tr.ok) throw new Error(`Trigger failed: HTTP ${tr.status}`);
      const r = await botFetch("/api/schedule");
      if (!r.ok) throw new Error(`Refresh failed: HTTP ${r.status}`);
      setEntries(await r.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trigger failed");
    }
  }

  return (
    <div className="p-6 space-y-3 max-w-4xl">
      <h2 className="text-lg font-semibold text-foreground mb-4">Schedule</h2>
      {error && <p className="text-destructive text-sm">{error}</p>}
      {!error && entries.length === 0 && <p className="text-muted-foreground">No scheduled tasks</p>}
      {entries.map((e) => (
        <div key={e.id} className="bg-card rounded-lg border border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <code className="text-primary text-sm">{e.cron}</code>
              <span
                className={`text-xs px-2 py-0.5 rounded-md font-medium ${
                  e.status === "active"
                    ? "bg-success/15 text-success"
                    : "bg-warning/15 text-warning"
                }`}
              >
                {e.status}
              </span>
            </div>
            <button
              onClick={() => trigger(e.id)}
              className="text-sm bg-secondary hover:bg-secondary/80 text-secondary-foreground px-3 py-1 rounded-md transition-colors"
            >
              Trigger
            </button>
          </div>
          <p className="text-sm text-foreground mb-2">{e.prompt}</p>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>Runs today: {e.runsToday}</span>
            {e.lastRunAt && <span>Last: {new Date(e.lastRunAt).toLocaleTimeString()}</span>}
            {e.nextRunAt && <span>Next: {new Date(e.nextRunAt).toLocaleTimeString()}</span>}
            {e.lastResult && (
              <span className={e.lastResult === "error" ? "text-destructive" : ""}>
                Result: {e.lastResult}
              </span>
            )}
            {e.consecutiveErrors > 0 && (
              <span className="text-destructive">Errors: {e.consecutiveErrors}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
