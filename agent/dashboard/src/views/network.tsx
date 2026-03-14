import { useState, useEffect, useCallback, useRef } from "react";
import { fleetFetch } from "../lib/fleet-context";
import { Button, Card } from "../components";

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
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const refresh = useCallback(() => {
    fleetFetch("/api/network")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        if (!Array.isArray(data)) return;
        const typed = data as NetworkEvent[];
        setEvents(typed.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 100));

        const conns = new Map<string, { count: number; lastSeen: string }>();
        for (const e of typed) {
          if (e.type === "mecha_call" && e.target) {
            const key = `${e.source_bot} → ${e.target}`;
            const existing = conns.get(key);
            conns.set(key, {
              count: (existing?.count ?? 0) + 1,
              lastSeen: e.timestamp > (existing?.lastSeen ?? "") ? e.timestamp : (existing?.lastSeen ?? ""),
            });
          }
        }
        setConnections(conns);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 10_000);
    return () => clearInterval(pollRef.current);
  }, [refresh]);

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto h-full overflow-y-auto">
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">Communication Map</h2>
        {connections.size === 0 ? (
          <p className="text-muted-foreground text-sm">No bot-to-bot communication recorded</p>
        ) : (
          <div className="space-y-2">
            {Array.from(connections.entries()).map(([key, val]) => (
              <Card
                key={key}
                compact
                className="flex items-center justify-between"
              >
                <span className="font-mono text-sm text-primary">{key}</span>
                <div className="flex gap-4 text-sm text-muted-foreground">
                  <span>{val.count} calls</span>
                  <span>Last: {new Date(val.lastSeen).toLocaleString()}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Recent Events</h2>
          <Button variant="secondary" size="xs" onClick={refresh}>
            Refresh
          </Button>
        </div>
        <div className="space-y-1 font-mono text-sm">
          {events.length === 0 && <p className="text-muted-foreground">No events</p>}
          {events.slice(0, 50).map((e, i) => (
            <div key={`${e.timestamp}-${i}`} className="flex gap-3 py-1 border-b border-border/50">
              <span className="text-muted-foreground shrink-0">
                {new Date(e.timestamp).toLocaleTimeString()}
              </span>
              <span className="text-yellow-600 dark:text-yellow-400 shrink-0">{e.source_bot}</span>
              <span className="text-muted-foreground">{e.type}</span>
              {e.target && <span className="text-primary">→ {e.target}</span>}
              {e.success !== undefined && (
                <span className={e.success ? "text-green-600 dark:text-green-400" : "text-destructive"}>
                  {e.success ? "ok" : "fail"}
                </span>
              )}
              {e.duration !== undefined && (
                <span className="text-muted-foreground">{e.duration}ms</span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
