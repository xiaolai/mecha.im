import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useFetch } from "@/lib/use-fetch";

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
  casaState?: string;
}

export function SessionList({ name, node, casaState }: SessionListProps) {
  const isRunning = casaState === "running" || casaState === undefined;
  const nodeQuery = node && node !== "local" ? `?node=${encodeURIComponent(node)}` : "";
  const { data: sessions, loading, error } = useFetch<SessionEntry[]>(
    isRunning ? `/casas/${encodeURIComponent(name)}/sessions${nodeQuery}` : null,
    { deps: [name, node, isRunning] },
  );

  if (!isRunning) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        CASA is not running. Start it to view sessions.
      </div>
    );
  }

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

  const terminalBase = `/casa/${encodeURIComponent(name)}/terminal`;

  function sessionLink(id: string): string {
    const params = new URLSearchParams({ session: id });
    if (node && node !== "local") params.set("node", node);
    return `${terminalBase}?${params.toString()}`;
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
                  {s.createdAt ? new Date(s.createdAt).toLocaleString() : "—"}
                </Link>
              </TableCell>
              <TableCell className="p-0">
                <Link to={sessionLink(s.id)} className="block px-4 py-2 text-xs text-muted-foreground">
                  {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "—"}
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
