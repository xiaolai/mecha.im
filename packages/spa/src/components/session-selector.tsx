import { useFetch } from "@/lib/use-fetch";

interface Session {
  id: string;
  title?: string;
  createdAt?: string;
}

interface SessionSelectorProps {
  botName: string;
  node?: string;
  currentSessionId?: string;
  botState?: string;
  onSelect: (sessionId: string | undefined) => void;
}

const POLL_INTERVAL_MS = 10_000;
const DEFAULT_TITLE = "(active session)";

function formatSessionLabel(s: Session): string {
  const hasRealTitle = s.title && s.title !== DEFAULT_TITLE;
  const label = hasRealTitle ? s.title! : s.id.slice(0, 8);
  if (!s.createdAt) return label;
  const time = new Date(s.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${label} \u00b7 ${time}`;
}

export function SessionSelector({ botName, node, currentSessionId, botState, onSelect }: SessionSelectorProps) {
  const isRunning = botState === "running" || botState === undefined;
  const nodeQuery = node && node !== "local" ? `?node=${encodeURIComponent(node)}` : "";
  const { data: sessions, loading, error } = useFetch<Session[]>(
    isRunning ? `/bots/${encodeURIComponent(botName)}/sessions${nodeQuery}` : null,
    { deps: [botName, node, isRunning], interval: isRunning ? POLL_INTERVAL_MS : undefined },
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
            {formatSessionLabel(s)}
          </option>
        ))}
      </select>
    </div>
  );
}
