import { useState, useEffect } from "react";

interface LogEntry {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

export default function Logs() {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  useEffect(() => {
    fetch("/api/logs?limit=100")
      .then((r) => r.json())
      .then((data) => setEntries(data.reverse()))
      .catch(() => {});
  }, []);

  function refresh() {
    fetch("/api/logs?limit=100")
      .then((r) => r.json())
      .then((data) => setEntries(data.reverse()))
      .catch(() => {});
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Event Log</h2>
        <button
          onClick={refresh}
          className="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded"
        >
          Refresh
        </button>
      </div>
      <div className="space-y-1 font-mono text-sm">
        {entries.length === 0 && <p className="text-gray-500">No events</p>}
        {entries.map((entry, i) => (
          <div key={i} className="flex gap-3 py-1 border-b border-gray-800/50">
            <span className="text-gray-500 shrink-0">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            <span
              className={`shrink-0 ${
                entry.type === "mecha_call"
                  ? "text-blue-400"
                  : entry.type === "error"
                    ? "text-red-400"
                    : "text-gray-400"
              }`}
            >
              {entry.type}
            </span>
            <span className="text-gray-300 truncate">
              {Object.entries(entry)
                .filter(([k]) => k !== "type" && k !== "timestamp")
                .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                .join(" ")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
