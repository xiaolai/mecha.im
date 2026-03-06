import { useState } from "react";
import { Trash2Icon, PlusIcon, Loader2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";

const ALL_CAPABILITIES = ["query", "read_workspace", "write_workspace", "execute", "read_sessions", "lifecycle"];

interface AclRule {
  source: string;
  target: string;
  capabilities: string[];
}

export function AclView() {
  const { data: rules, loading, error, refetch } = useFetch<AclRule[]>("/acl");
  const { authHeaders } = useAuth();
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [capability, setCapability] = useState("query");
  const [granting, setGranting] = useState(false);

  async function handleGrant() {
    if (!source || !target) return;
    setGranting(true);
    try {
      await fetch("/acl/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({ source, target, capability }),
      });
      setSource("");
      setTarget("");
      refetch();
    } finally {
      setGranting(false);
    }
  }

  async function handleRevoke(src: string, tgt: string, cap: string) {
    await fetch("/acl/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      credentials: "include",
      body: JSON.stringify({ source: src, target: tgt, capability: cap }),
    });
    refetch();
  }

  if (loading && !rules) {
    return <Skeleton className="h-48 rounded-lg" />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Grant form */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5 flex-1">
          <label className="text-xs font-medium text-muted-foreground">Source</label>
          <input type="text" value={source} onChange={(e) => setSource(e.target.value)} placeholder="alice"
            className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <div className="flex flex-col gap-1.5 flex-1">
          <label className="text-xs font-medium text-muted-foreground">Target</label>
          <input type="text" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="bob"
            className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Capability</label>
          <select value={capability} onChange={(e) => setCapability(e.target.value)}
            className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
            {ALL_CAPABILITIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <Button size="sm" disabled={!source || !target || granting} onClick={handleGrant} className="h-11 sm:h-9">
          {granting ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
          Grant
        </Button>
      </div>

      {/* Rules table */}
      {(!rules || rules.length === 0) ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No ACL rules defined.</p>
        </div>
      ) : (
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
              {rules.map((rule) => (
                <TableRow key={`${rule.source}:${rule.target}`}>
                  <TableCell className="font-mono text-sm">{rule.source}</TableCell>
                  <TableCell className="font-mono text-sm">{rule.target}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {rule.capabilities.map((cap) => (
                        <Badge key={cap} variant="secondary" className="text-xs inline-flex items-center gap-1">
                          {cap}
                          <button
                            type="button"
                            onClick={() => handleRevoke(rule.source, rule.target, cap)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                            aria-label={`Revoke ${cap}`}
                          >
                            <Trash2Icon className="size-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
