import { useFetch } from "@/lib/use-fetch";

interface Session {
  id: string;
  title?: string;
  createdAt?: string;
}

interface SessionSelectorProps {
  casaName: string;
  node?: string;
  currentSessionId?: string;
  casaState?: string;
  onSelect: (sessionId: string | undefined) => void;
}

const POLL_INTERVAL_MS = 10_000;

export function SessionSelector({ casaName, node, currentSessionId, casaState, onSelect }: SessionSelectorProps) {
  const isRunning = casaState === "running" || casaState === undefined;
  const nodeQuery = node && node !== "local" ? `?node=${encodeURIComponent(node)}` : "";
  const { data: sessions, loading, error } = useFetch<Session[]>(
    isRunning ? `/casas/${encodeURIComponent(casaName)}/sessions${nodeQuery}` : null,
    { deps: [casaName, node, isRunning], interval: isRunning ? POLL_INTERVAL_MS : undefined },
  );

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="session-select" className="text-sm font-medium text-muted-foreground whitespace-nowrap">
        Session:
      </label>
      {error && isRunning && <span className="text-xs text-destructive">{error}</span>}
      <select
        id="session-select"
        className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
        value={currentSessionId ?? "__new__"}
        onChange={(e) => onSelect(e.target.value === "__new__" ? undefined : e.target.value)}
        disabled={loading && !sessions}
      >
        <option value="__new__">New Session</option>
        {sessions?.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title ?? s.id}
            {s.createdAt ? ` (${new Date(s.createdAt).toLocaleDateString()})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
