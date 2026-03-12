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

  useEffect(() => {
    let active = true;
    const load = () => {
      botFetch("/api/sessions")
        .then((r) => r.json())
        .then((data) => { if (active && Array.isArray(data)) setSessions(data as SessionSummary[]); })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  return (
    <div className="w-72 shrink-0 border-r border-gray-700 flex flex-col bg-gray-900/50 h-full overflow-hidden">
      <div className="p-3 border-b border-gray-700">
        <button
          onClick={onNewSession}
          className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium"
        >
          + New Session
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 && (
          <p className="text-gray-500 text-sm p-4 text-center">No sessions yet</p>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id, s.hasPty)}
            className={`w-full text-left px-3 py-3 border-b border-gray-800 hover:bg-gray-800/60 transition-colors ${
              selectedId === s.id ? "bg-blue-900/30 border-l-2 border-l-blue-500" : ""
            }`}
          >
            <div className="flex items-start gap-2">
              <span
                className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                  s.hasPty ? "bg-green-400 animate-pulse" : "bg-gray-600"
                }`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-200 truncate">{s.title}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                  <span>{timeAgo(s.lastActivity)}</span>
                  <span className="text-gray-700">·</span>
                  <span>{s.messageCount} msgs</span>
                  <span className="text-gray-700">·</span>
                  <span className="text-gray-600">{modelShort(s.model)}</span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
