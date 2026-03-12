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
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Status */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Status</h2>
        {status && (
          <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4 font-mono text-sm">
            <pre>{JSON.stringify(status, null, 2)}</pre>
          </div>
        )}
      </section>

      {/* Costs */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Costs</h2>
        {costs && (
          <div className="grid grid-cols-3 gap-4">
            {Object.entries(costs).map(([k, v]) => (
              <div key={k} className="bg-gray-800/50 rounded-lg border border-gray-700 p-4 text-center">
                <div className="text-2xl font-bold">${typeof v === "number" ? v.toFixed(4) : String(v)}</div>
                <div className="text-gray-500 text-sm mt-1">{k}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Configuration */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Configuration</h2>
        {config && (
          <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4 font-mono text-sm">
            <pre>{JSON.stringify(config, null, 2)}</pre>
          </div>
        )}
      </section>

      {/* Event Log */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Event Log</h2>
          <button
            onClick={refreshLogs}
            className="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded"
          >
            Refresh
          </button>
        </div>
        <div className="space-y-1 font-mono text-sm max-h-96 overflow-y-auto">
          {logs.length === 0 && <p className="text-gray-500">No events</p>}
          {logs.map((entry, i) => (
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
      </section>
    </div>
  );
}
