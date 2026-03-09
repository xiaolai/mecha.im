import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useFetch } from "@/lib/use-fetch";

interface SystemEvent {
  ts: string;
  severity: "info" | "warn" | "error";
  category: string;
  event: string;
  message: string;
  meta?: Record<string, unknown>;
}

const severityBadge = {
  info: "default" as const,
  warn: "warning" as const,
  error: "destructive" as const,
};

/** Table of system events with severity, category, and message columns. */
export function EventsView() {
  const { data: events, loading, error } = useFetch<SystemEvent[]>("/events/log?limit=100", { interval: 10000 });

  if (loading && !events) {
    return <Skeleton className="h-48 rounded-lg" />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">No events recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Severity</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Message</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((e, i) => (
            <TableRow key={`${e.ts}:${e.event}:${i}`}>
              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                {new Date(e.ts).toLocaleString()}
              </TableCell>
              <TableCell>
                <Badge variant={severityBadge[e.severity]}>{e.severity}</Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{e.category}</TableCell>
              <TableCell className="font-mono text-xs">{e.event}</TableCell>
              <TableCell className="text-xs max-w-md truncate">{e.message}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
