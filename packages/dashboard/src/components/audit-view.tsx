"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

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
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function fetchAudit() {
      try {
        const res = await fetch("/api/audit?limit=100");
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Failed to fetch" }));
          if (active) setError(body.error ?? "Failed to fetch audit log");
          return;
        }
        const data = await res.json();
        if (active) { setEntries(data); setError(null); }
      } catch {
        if (active) setError("Failed to connect to server");
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchAudit();
    const interval = setInterval(fetchAudit, 10000);
    return () => { active = false; clearInterval(interval); };
  }, []);

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

  if (entries.length === 0) {
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
          {entries.map((entry, i) => (
            <TableRow key={i}>
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
