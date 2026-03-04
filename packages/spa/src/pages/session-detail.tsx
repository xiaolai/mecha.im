import { useParams, useSearchParams, Link } from "react-router-dom";
import { ArrowLeftIcon, TerminalIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ConversationView } from "@/components/conversation-view";
import { Button } from "@/components/ui/button";
import { useFetch } from "@/lib/use-fetch";

function safeDate(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : "—";
}

interface TranscriptEvent {
  type: string;
  [key: string]: unknown;
}

interface Session {
  id: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  events: TranscriptEvent[];
}

export function SessionDetailPage() {
  const { name, id } = useParams<{ name: string; id: string }>();
  const [searchParams] = useSearchParams();
  const node = searchParams.get("node") ?? undefined;
  const nodeQuery = node && node !== "local" ? `?node=${encodeURIComponent(node)}` : "";

  const { data: session, loading, error } = useFetch<Session>(
    name && id ? `/bots/${encodeURIComponent(name)}/sessions/${encodeURIComponent(id)}${nodeQuery}` : null,
    { deps: [name, id, node] },
  );

  if (!name || !id) return null;

  const backLink = `/bot/${encodeURIComponent(name)}${nodeQuery}`;

  const terminalParams = new URLSearchParams({ session: id });
  if (node && node !== "local") terminalParams.set("node", node);
  const terminalLink = `/bot/${encodeURIComponent(name)}/terminal?${terminalParams.toString()}`;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to={backLink}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground shrink-0"
          >
            <ArrowLeftIcon className="size-4" />
            <span className="hidden sm:inline">{name}</span>
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">
              {session?.title ?? "(active session)"}
            </h1>
            {session && (
              <p className="text-xs text-muted-foreground">
                {session.createdAt && safeDate(session.createdAt)}
                {session.updatedAt && session.updatedAt !== session.createdAt && (
                  <> · updated {safeDate(session.updatedAt)}</>
                )}
              </p>
            )}
          </div>
        </div>
        <Link to={terminalLink} className="shrink-0">
          <Button variant="outline" size="sm" className="w-full sm:w-auto">
            <TerminalIcon className="size-4" />
            Attach Terminal to Session
          </Button>
        </Link>
      </div>

      {/* Body */}
      {loading && !session && (
        <div className="flex-1 p-4">
          <Skeleton className="h-full rounded-lg" />
        </div>
      )}
      {error && (
        <div className="m-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}
      {session && <ConversationView events={session.events} />}
    </div>
  );
}
