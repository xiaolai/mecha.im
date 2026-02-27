"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

interface AclRule {
  source: string;
  target: string;
  capabilities: string[];
}

export function AclView() {
  const [rules, setRules] = useState<AclRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function fetchRules() {
      try {
        const res = await fetch("/api/acl");
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Failed to fetch" }));
          if (active) setError(body.error ?? "Failed to fetch ACL rules");
          return;
        }
        const data = await res.json();
        if (active) { setRules(data); setError(null); }
      } catch {
        if (active) setError("Failed to connect to server");
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchRules();
    return () => { active = false; };
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

  if (rules.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">No ACL rules defined.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Use <code className="font-mono">mecha acl grant</code> to create rules.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Capabilities</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((rule, i) => (
            <TableRow key={i}>
              <TableCell className="font-mono text-sm">{rule.source}</TableCell>
              <TableCell className="font-mono text-sm">{rule.target}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {rule.capabilities.map((cap) => (
                    <Badge key={cap} variant="secondary" className="text-xs">{cap}</Badge>
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
