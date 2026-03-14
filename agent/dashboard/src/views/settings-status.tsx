import { useState, useEffect, useRef, useCallback } from "react";
import { botFetch, botUrl } from "../lib/api";

interface BotStatus {
  name: string;
  state: string;
  model: string;
  uptime: number;
  current_task: string | null;
  current_session_id: string | null;
  talking_to: string | null;
  last_active: string | null;
}

const STATE_COLORS: Record<string, string> = {
  idle: "bg-green-500",
  thinking: "bg-yellow-500",
  calling: "bg-yellow-500",
  scheduled: "bg-yellow-500",
  webhook: "bg-yellow-500",
  error: "bg-red-500",
};

function stateColor(state: string): string {
  return STATE_COLORS[state] ?? "bg-muted-foreground";
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}

function formatRelative(isoOrNull: string | null): string {
  if (!isoOrNull) return "never";
  const ts = new Date(isoOrNull).getTime();
  if (isNaN(ts)) return "never";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function StatusCard() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await botFetch("/api/status");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setStatus(data as BotStatus);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(fetchStatus, 5000);
  }, [fetchStatus, stopPolling]);

  useEffect(() => {
    fetchStatus();

    const es = new EventSource(botUrl("/api/status/stream"));
    esRef.current = es;

    es.addEventListener("state", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setStatus((prev) => (prev ? { ...prev, ...data } : data as BotStatus));
        setError(null);
        stopPolling();
      } catch {}
    });

    es.onerror = () => {
      if (!pollRef.current) startPolling();
    };

    tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);

    return () => {
      es.close();
      esRef.current = null;
      stopPolling();
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [fetchStatus, startPolling, stopPolling]);

  if (error && !status) {
    return (
      <div className="bg-card rounded-lg border border-border p-4">
        <h2 className="text-lg font-semibold text-foreground mb-2">Status</h2>
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="bg-card rounded-lg border border-border p-4">
        <h2 className="text-lg font-semibold text-foreground mb-2">Status</h2>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const displayUptime = formatUptime(status.uptime > 0 ? status.uptime : 0);

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h2 className="text-lg font-semibold text-foreground mb-3">Status</h2>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${stateColor(status.state)}`} />
          <span className="text-sm font-medium text-foreground capitalize">{status.state}</span>
        </div>
        <span className="text-sm text-muted-foreground">
          Uptime: <span className="text-foreground font-mono">{displayUptime}</span>
        </span>
      </div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted-foreground">
          Model: <span className="text-foreground font-mono">{status.model || "unknown"}</span>
        </span>
        <span className="text-sm text-muted-foreground">
          Last active: <span className="text-foreground font-mono">{formatRelative(status.last_active)}</span>
        </span>
      </div>
      <div className="pt-2 border-t border-border">
        {status.current_task ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Task</span>
            <span className="font-mono text-foreground">{status.current_task.slice(0, 8)}</span>
            {status.talking_to && (
              <>
                <span className="text-muted-foreground">with</span>
                <span className="font-mono text-foreground">{status.talking_to}</span>
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No active task</p>
        )}
      </div>
    </div>
  );
}
