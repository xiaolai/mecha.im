"use client";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useFetch } from "@/lib/use-fetch";

interface AuditEntry {
  ts: string;
  client: string;
  tool: string;
  params: Record<string, unknown>;
  result: "ok" | "error" | "rate-limited";
  error?: string;
  durationMs: number;
}

const resultBadge = {
  ok: "success" as const,
  error: "destructive" as const,
  "rate-limited": "warning" as const,
};

export function AuditView() {
  const { data: entries, loading, error } = useFetch<AuditEntry[]>("/api/audit?limit=100", { interval: 10000 });

  if (loading) {
    return <Skeleton className="h-48 rounded-lg" />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">No audit entries found.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Tool</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Result</TableHead>
            <TableHead className="text-right">Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={`${entry.ts}:${entry.tool}:${entry.client}`}>
              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                {new Date(entry.ts).toLocaleString()}
              </TableCell>
              <TableCell className="font-mono text-xs">{entry.tool}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{entry.client}</TableCell>
              <TableCell>
                <Badge variant={resultBadge[entry.result]}>{entry.result}</Badge>
              </TableCell>
              <TableCell className="text-right text-xs font-mono text-muted-foreground">
                {entry.durationMs}ms
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
