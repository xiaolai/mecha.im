"use client";

import { useState, useEffect } from "react";

interface Session {
  id: string;
  title?: string;
  createdAt?: string;
}

interface SessionSelectorProps {
  casaName: string;
  node?: string;
  currentSessionId?: string;
  onSelect: (sessionId: string | undefined) => void;
}

export function SessionSelector({ casaName, node, currentSessionId, onSelect }: SessionSelectorProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const nodeQuery = node && node !== "local" ? `?node=${encodeURIComponent(node)}` : "";
    fetch(`/api/casas/${encodeURIComponent(casaName)}/sessions${nodeQuery}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Session[]) => setSessions(data))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, [casaName, node]);

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="session-select" className="text-sm font-medium text-muted-foreground whitespace-nowrap">
        Session:
      </label>
      <select
        id="session-select"
        className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
        value={currentSessionId ?? "__new__"}
        onChange={(e) => onSelect(e.target.value === "__new__" ? undefined : e.target.value)}
        disabled={loading}
      >
        <option value="__new__">New Session</option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title ?? s.id}
            {s.createdAt ? ` (${new Date(s.createdAt).toLocaleDateString()})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
