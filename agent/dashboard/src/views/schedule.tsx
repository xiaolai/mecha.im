import { useState, useEffect } from "react";

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

  useEffect(() => {
    fetch("/api/schedule")
      .then((r) => r.json())
      .then(setEntries)
      .catch(() => {});
  }, []);

  async function trigger(id: string) {
    await fetch(`/api/schedule/trigger/${encodeURIComponent(id)}`, { method: "POST" });
    // Refresh
    const r = await fetch("/api/schedule");
    setEntries(await r.json());
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold mb-4">Schedule</h2>
      {entries.length === 0 && <p className="text-gray-500">No scheduled tasks</p>}
      {entries.map((e) => (
        <div key={e.id} className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <code className="text-blue-400 text-sm">{e.cron}</code>
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  e.status === "active" ? "bg-green-900 text-green-300" : "bg-yellow-900 text-yellow-300"
                }`}
              >
                {e.status}
              </span>
            </div>
            <button
              onClick={() => trigger(e.id)}
              className="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded"
            >
              Trigger
            </button>
          </div>
          <p className="text-sm text-gray-300 mb-2">{e.prompt}</p>
          <div className="flex gap-4 text-xs text-gray-500">
            <span>Runs today: {e.runsToday}</span>
            {e.lastRunAt && <span>Last: {new Date(e.lastRunAt).toLocaleTimeString()}</span>}
            {e.nextRunAt && <span>Next: {new Date(e.nextRunAt).toLocaleTimeString()}</span>}
            {e.lastResult && (
              <span className={e.lastResult === "error" ? "text-red-400" : ""}>
                Result: {e.lastResult}
              </span>
            )}
            {e.consecutiveErrors > 0 && (
              <span className="text-red-400">Errors: {e.consecutiveErrors}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
