import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useFetch } from "@/lib/use-fetch";

function safeDate(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : "—";
}

interface SessionEntry {
  id: string;
  title?: string;
  starred?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface SessionListProps {
  name: string;
  node?: string;
}

/** Table listing all sessions for a bot with links to session detail. */
export function SessionList({ name, node }: SessionListProps) {
  const nodeQuery = node && node !== "local" ? `?node=${encodeURIComponent(node)}` : "";
  const { data: sessions, loading, error } = useFetch<SessionEntry[]>(
    `/bots/${encodeURIComponent(name)}/sessions${nodeQuery}`,
    { deps: [name, node] },
  );

  if (loading && !sessions) {
    return <Skeleton className="h-32 rounded-lg" />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        No sessions yet.
      </div>
    );
  }

  function sessionLink(id: string): string {
    const base = `/bot/${encodeURIComponent(name)}/session/${encodeURIComponent(id)}`;
    return node && node !== "local" ? `${base}?node=${encodeURIComponent(node)}` : base;
  }

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Session ID</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((s) => (
            <TableRow key={s.id} className="cursor-pointer hover:bg-accent/50">
              <TableCell className="p-0">
                <Link to={sessionLink(s.id)} className="block px-4 py-2 font-mono text-xs">
                  {s.id}
                </Link>
              </TableCell>
              <TableCell className="p-0">
                <Link to={sessionLink(s.id)} className="block px-4 py-2">
                  {s.title ?? "—"}
                </Link>
              </TableCell>
              <TableCell className="p-0">
                <Link to={sessionLink(s.id)} className="block px-4 py-2 text-xs text-muted-foreground">
                  {s.createdAt ? safeDate(s.createdAt) : "—"}
                </Link>
              </TableCell>
              <TableCell className="p-0">
                <Link to={sessionLink(s.id)} className="block px-4 py-2 text-xs text-muted-foreground">
                  {s.updatedAt ? safeDate(s.updatedAt) : "—"}
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
