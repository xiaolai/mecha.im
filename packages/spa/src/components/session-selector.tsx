import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/auth-context";

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
  const [error, setError] = useState<string | null>(null);
  const { authHeaders, logout } = useAuth();

  useEffect(() => {
    setLoading(true);
    setError(null);
    const nodeQuery = node && node !== "local" ? `?node=${encodeURIComponent(node)}` : "";
    fetch(`/casas/${encodeURIComponent(casaName)}/sessions${nodeQuery}`, { headers: authHeaders })
      .then(async (res) => {
        if (res.status === 401) { logout(); return []; }
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Request failed" }));
          setError(body.error ?? `Error ${res.status}`);
          return [];
        }
        return res.json();
      })
      .then((data: Session[]) => setSessions(data))
      .catch(() => { setSessions([]); setError("Failed to load sessions"); })
      .finally(() => setLoading(false));
  }, [casaName, node, authHeaders, logout]);

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="session-select" className="text-sm font-medium text-muted-foreground whitespace-nowrap">
        Session:
      </label>
      {error && <span className="text-xs text-destructive">{error}</span>}
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
