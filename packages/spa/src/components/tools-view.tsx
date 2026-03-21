import { useState } from "react";
import { Trash2Icon, PlusIcon, Loader2Icon, TerminalSquareIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";

interface ToolInfo {
  name: string;
  version: string;
  description: string;
}

interface ClaudeRuntimeInfo {
  binPath: string | null;
  version: string | null;
  resolvedFrom: string;
}

const RESOLVED_LABELS: Record<string, string> = {
  "local-bin": "~/.local/bin/claude",
  "claude-local": "~/.claude/local/bin/claude",
  "usr-local": "/usr/local/bin/claude",
  "usr-bin": "/usr/bin/claude",
  "path": "PATH lookup",
  "not-found": "Not found",
};

function ClaudeRuntimeCard() {
  const { data: runtime, loading, error } = useFetch<ClaudeRuntimeInfo>("/tools/runtime");

  if (loading) return <Skeleton className="h-28 rounded-lg" />;
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load Claude runtime info
      </div>
    );
  }

  const found = runtime?.binPath != null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <TerminalSquareIcon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-card-foreground">Claude Code Runtime</h2>
        <Badge variant={found ? "default" : "destructive"} className="ml-auto">
          {found ? `v${runtime!.version ?? "unknown"}` : "Not found"}
        </Badge>
      </div>
      {found ? (
        <div className="flex flex-col gap-1 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-muted-foreground">Binary</span>
            <span className="font-mono text-card-foreground truncate text-right" title={runtime!.binPath!}>
              {runtime!.binPath}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-muted-foreground">Resolved from</span>
            <span className="text-card-foreground">
              {RESOLVED_LABELS[runtime!.resolvedFrom] ?? runtime!.resolvedFrom}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Claude Code is not installed. Install with: <code className="font-mono text-card-foreground">npm install -g @anthropic-ai/claude-code</code>
        </p>
      )}
    </div>
  );
}

/** Renders installed tools table with install/remove actions and Claude runtime info. */
export function ToolsView() {
  const { data: tools, loading, error, refetch } = useFetch<ToolInfo[]>("/tools");
  const { authHeaders } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");
  const [installing, setInstalling] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function handleInstall() {
    if (!name.trim()) return;
    setInstalling(true);
    setFormError(null);
    try {
      const res = await fetch("/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          version: version.trim() || undefined,
          description: description.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        setFormError(data.error ?? "Failed to install tool");
        return;
      }
      setName("");
      setVersion("");
      setDescription("");
      setShowForm(false);
      refetch();
    } catch {
      setFormError("Connection error");
    } finally {
      setInstalling(false);
    }
  }

  async function handleRemove(toolName: string) {
    setRemoveError(null);
    try {
      const res = await fetch(`/tools/${encodeURIComponent(toolName)}`, {
        method: "DELETE",
        headers: authHeaders,
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        setRemoveError(data.error ?? "Failed to remove tool");
        return;
      }
      refetch();
    } catch {
      setRemoveError("Connection error");
    }
  }

  if (loading && !tools) {
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
      {/* Claude Runtime Info */}
      <ClaudeRuntimeCard />

      {/* Install form toggle */}
      {!showForm ? (
        <div>
          <Button size="sm" onClick={() => setShowForm(true)} className="w-full sm:w-auto">
            <PlusIcon className="size-4" />
            Install Tool
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="web-search"
                className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-xs font-medium text-muted-foreground">Version</label>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="1.0.0"
                className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Search the web"
                className="h-11 sm:h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={!name.trim() || installing} onClick={handleInstall} className="h-11 sm:h-9">
              {installing ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
              Install
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setFormError(null); }} className="h-11 sm:h-9">
              Cancel
            </Button>
          </div>
          {formError && (
            <p className="text-xs text-destructive">{formError}</p>
          )}
        </div>
      )}

      {removeError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{removeError}</div>
      )}

      {/* Tools table */}
      {(!tools || tools.length === 0) ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No tools installed.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Version</TableHead>
                <TableHead className="hidden sm:table-cell">Description</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tools.map((tool) => (
                <TableRow key={tool.name}>
                  <TableCell className="font-mono text-sm">{tool.name}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">{tool.version}</TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{tool.description || "\u2014"}</TableCell>
                  <TableCell>
                    <TooltipIconButton
                      tooltip="Remove"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleRemove(tool.name)}
                    >
                      <Trash2Icon className="text-destructive" />
                    </TooltipIconButton>
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
