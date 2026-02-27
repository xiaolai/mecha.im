"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

interface SessionEntry {
  id: string;
  title?: string;
  starred?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface SessionListProps {
  name: string;
}

export function SessionList({ name }: SessionListProps) {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function fetchSessions() {
      try {
        const res = await fetch(`/api/casas/${encodeURIComponent(name)}/sessions`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Failed to fetch" }));
          if (active) setError(body.error ?? "Failed to fetch sessions");
          return;
        }
        const data = await res.json();
        if (active) {
          setSessions(data);
          setError(null);
        }
      } catch {
        if (active) setError("Failed to connect to server");
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchSessions();
    return () => { active = false; };
  }, [name]);

  if (loading) {
    return <Skeleton className="h-32 rounded-lg" />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        No sessions yet.
      </div>
    );
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
            <TableRow key={s.id}>
              <TableCell className="font-mono text-xs">{s.id}</TableCell>
              <TableCell>{s.title ?? "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {s.createdAt ? new Date(s.createdAt).toLocaleString() : "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
