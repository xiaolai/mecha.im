import { useState, useEffect } from "react";

interface NetworkEvent {
  type: string;
  timestamp: string;
  source_bot: string;
  target?: string;
  success?: boolean;
  duration?: number;
  [key: string]: unknown;
}

export default function Network() {
  const [events, setEvents] = useState<NetworkEvent[]>([]);
  const [connections, setConnections] = useState<Map<string, { count: number; lastSeen: string }>>(new Map());

  useEffect(() => {
    fetch("/api/network")
      .then((r) => r.json())
      .then((data: NetworkEvent[]) => {
        setEvents(data.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 100));

        // Build connection graph
        const conns = new Map<string, { count: number; lastSeen: string }>();
        for (const e of data) {
          if (e.type === "mecha_call" && e.target) {
            const key = `${e.source_bot} → ${e.target}`;
            const existing = conns.get(key);
            conns.set(key, {
              count: (existing?.count ?? 0) + 1,
              lastSeen: e.timestamp > (existing?.lastSeen ?? "") ? e.timestamp : existing!.lastSeen,
            });
          }
        }
        setConnections(conns);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold mb-4">Communication Map</h2>
        {connections.size === 0 ? (
          <p className="text-gray-500">No bot-to-bot communication recorded</p>
        ) : (
          <div className="space-y-2">
            {Array.from(connections.entries()).map(([key, val]) => (
              <div
                key={key}
                className="bg-gray-800/50 rounded-lg border border-gray-700 p-3 flex items-center justify-between"
              >
                <span className="font-mono text-sm text-blue-400">{key}</span>
                <div className="flex gap-4 text-sm text-gray-400">
                  <span>{val.count} calls</span>
                  <span>Last: {new Date(val.lastSeen).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-4">Recent Events</h2>
        <div className="space-y-1 font-mono text-sm">
          {events.length === 0 && <p className="text-gray-500">No events</p>}
          {events.slice(0, 50).map((e, i) => (
            <div key={i} className="flex gap-3 py-1 border-b border-gray-800/50">
              <span className="text-gray-500 shrink-0">
                {new Date(e.timestamp).toLocaleTimeString()}
              </span>
              <span className="text-yellow-400 shrink-0">{e.source_bot}</span>
              <span className="text-gray-400">{e.type}</span>
              {e.target && <span className="text-blue-400">→ {e.target}</span>}
              {e.success !== undefined && (
                <span className={e.success ? "text-green-400" : "text-red-400"}>
                  {e.success ? "ok" : "fail"}
                </span>
              )}
              {e.duration !== undefined && (
                <span className="text-gray-500">{e.duration}ms</span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
