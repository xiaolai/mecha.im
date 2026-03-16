import { useState, useEffect, useRef, useCallback } from "react";
import { botFetch, botUrl } from "../lib/api";
import { Card, StatusDot } from "../components";

interface BotStatus {
  name: string;
  state: string;
  model: string;
  uptime: number;
  current_task: string | null;
  current_session_id: string | null;
  talking_to: string | null;
  last_active: string | null;
  versions?: Record<string, string>;
}

const VERSION_LABELS = [
  { key: "claude_code", label: "Claude Code CLI" },
  { key: "claude_agent_sdk_js", label: "Agent SDK (JS)" },
  { key: "claude_agent_sdk_py", label: "Agent SDK (Python)" },
  { key: "codex", label: "Codex CLI" },
  { key: "gemini_cli", label: "Gemini CLI" },
];

const STATE_COLORS: Record<string, "green" | "yellow" | "red" | "muted"> = {
  idle: "green",
  thinking: "yellow",
  calling: "yellow",
  scheduled: "yellow",
  webhook: "yellow",
  error: "red",
};

function stateColor(state: string): "green" | "yellow" | "red" | "muted" {
  return STATE_COLORS[state] ?? "muted";
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
  const uptimeBaseRef = useRef<{ serverUptime: number; fetchedAt: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await botFetch("/api/status");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as BotStatus;
      uptimeBaseRef.current = { serverUptime: data.uptime, fetchedAt: Date.now() / 1000 };
      setStatus(data);
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

    const handleSSE = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        // Normalize camelCase SSE fields to snake_case BotStatus
        const normalized: Partial<BotStatus> = {};
        // snapshot sends "activity", state events send "state"
        if (data.state) normalized.state = data.state;
        else if (data.activity) normalized.state = data.activity;
        if ("talkingTo" in data) normalized.talking_to = data.talkingTo;
        if ("lastActive" in data) normalized.last_active = data.lastActive;
        if ("talking_to" in data) normalized.talking_to = data.talking_to;
        if ("last_active" in data) normalized.last_active = data.last_active;
        setStatus((prev) => prev ? { ...prev, ...normalized } : null);
        setError(null);
        stopPolling();
      } catch {}
    };

    es.addEventListener("state", handleSSE);
    es.addEventListener("snapshot", handleSSE);

    es.onopen = () => stopPolling();
    es.onerror = () => {
      if (!pollRef.current) startPolling();
    };

    tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);

    return () => {
      es.close();
      stopPolling();
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [fetchStatus, startPolling, stopPolling]);

  if (error && !status) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-foreground mb-2">Status</h2>
        <p className="text-sm text-destructive">{error}</p>
      </Card>
    );
  }

  if (!status) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-foreground mb-2">Status</h2>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </Card>
    );
  }

  const liveUptime = uptimeBaseRef.current
    ? uptimeBaseRef.current.serverUptime + (Date.now() / 1000 - uptimeBaseRef.current.fetchedAt)
    : status.uptime;
  const displayUptime = formatUptime(liveUptime > 0 ? liveUptime : 0);

  return (
    <Card>
      <h2 className="text-lg font-semibold text-foreground mb-3">Status</h2>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <StatusDot color={stateColor(status.state)} />
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
      {status.versions && (
        <div className="pt-2 border-t border-border mb-3">
          <h3 className="text-sm font-medium text-foreground mb-2">Installed Packages</h3>
          <div className="space-y-1">
            {VERSION_LABELS.map(({ key, label }) => {
              const ver = status.versions?.[key];
              if (!ver) return null;
              const installed = ver !== "not installed";
              return (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className={`text-xs font-mono ${installed ? "text-foreground" : "text-muted-foreground"}`}>
                    {ver}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
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
    </Card>
  );
}
