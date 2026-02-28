"use client";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useFetch } from "@/lib/use-fetch";

interface AclRule {
  source: string;
  target: string;
  capabilities: string[];
}

export function AclView() {
  const { data: rules, loading, error } = useFetch<AclRule[]>("/api/acl");

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

  if (!rules || rules.length === 0) {
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
