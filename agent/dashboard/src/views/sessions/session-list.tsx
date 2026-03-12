import { useState, useEffect } from "react";
import { botFetch } from "../../lib/api";

interface SessionSummary {
  id: string;
  title: string;
  timestamp: string;
  lastActivity: string;
  model: string;
  messageCount: number;
  costUsd: number;
  hasPty: boolean;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function modelShort(model: string): string {
  if (model.includes("opus")) return "opus";
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("haiku")) return "haiku";
  return model.split("-").pop() ?? model;
}

interface Props {
  selectedId: string | null;
  onSelect: (id: string, hasPty: boolean) => void;
  onNewSession: () => void;
}

export default function SessionList({ selectedId, onSelect, onNewSession }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval>;

    const load = () => {
      if (document.hidden) return;
      botFetch("/api/sessions")
        .then((r) => r.json())
        .then((data) => {
          if (active && Array.isArray(data)) {
            setSessions(data as SessionSummary[]);
            setLoadError(null);
          }
        })
        .catch((err) => {
          if (active) setLoadError(err instanceof Error ? err.message : "Failed to load sessions");
        });
    };

    load();
    timer = setInterval(load, 15_000);

    const onVisibility = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="w-72 shrink-0 border-r border-border flex flex-col bg-card h-full overflow-hidden">
      <div className="p-3 border-b border-border">
        <button
          onClick={onNewSession}
          className="w-full px-3 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-sm font-medium transition-colors"
        >
          + New Session
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loadError && (
          <p className="text-destructive text-sm p-4 text-center">{loadError}</p>
        )}
        {!loadError && sessions.length === 0 && (
          <p className="text-muted-foreground text-sm p-4 text-center">No sessions yet</p>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id, s.hasPty)}
            className={`w-full text-left px-3 py-3 border-b border-border hover:bg-accent transition-colors ${
              selectedId === s.id ? "bg-accent border-l-2 border-l-primary" : ""
            }`}
          >
            <div className="flex items-start gap-2">
              <span
                className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                  s.hasPty ? "bg-success animate-pulse" : "bg-muted-foreground/30"
                }`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground truncate">{s.title}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <span>{timeAgo(s.lastActivity)}</span>
                  <span className="opacity-30">·</span>
                  <span>{s.messageCount} msgs</span>
                  <span className="opacity-30">·</span>
                  <span>{modelShort(s.model)}</span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
