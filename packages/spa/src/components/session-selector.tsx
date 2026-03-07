import { useState, useCallback } from "react";
import { Trash2Icon, Loader2Icon } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";

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
  const nodeQuery = node ? `?node=${encodeURIComponent(node)}` : "";
  const { data: sessions, loading, error, refetch } = useFetch<Session[]>(
    isRunning ? `/bots/${encodeURIComponent(botName)}/sessions${nodeQuery}` : null,
    { deps: [botName, node, isRunning], interval: isRunning ? POLL_INTERVAL_MS : undefined },
  );
  const { authHeaders } = useAuth();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = useCallback(async () => {
    if (!currentSessionId || currentSessionId.startsWith("new-")) return;
    setDeleting(currentSessionId);
    setDeleteError(null);
    try {
      const res = await fetch(`/bots/${encodeURIComponent(botName)}/sessions/${encodeURIComponent(currentSessionId)}${nodeQuery}`, {
        method: "DELETE", headers: authHeaders, credentials: "include",
      });
      if (!res.ok) {
        setDeleteError("Failed to delete session");
        return;
      }
      onSelect(undefined);
      refetch();
    } catch {
      setDeleteError("Connection error");
    } finally {
      setDeleting(null);
    }
  }, [botName, currentSessionId, nodeQuery, authHeaders, onSelect, refetch]);

  const canDelete = currentSessionId && !currentSessionId.startsWith("new-") && !currentSessionId.startsWith("__");

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="session-select" className="text-sm font-medium text-muted-foreground whitespace-nowrap">
        Session:
      </label>
      {(error || deleteError) && isRunning && <span className="text-xs text-destructive">{deleteError ?? error}</span>}
      <select
        id="session-select"
        className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
        value={!currentSessionId || currentSessionId.startsWith("new-") ? "__new__" : currentSessionId}
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
      {canDelete && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={!!deleting}
          className="inline-flex items-center p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
          aria-label="Delete session"
        >
          {deleting ? <Loader2Icon className="size-3.5 animate-spin" /> : <Trash2Icon className="size-3.5" />}
        </button>
      )}
    </div>
  );
}
