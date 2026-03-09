import { useState, useCallback, useEffect } from "react";
import { Loader2Icon, CheckIcon, XIcon, CircleDotIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/auth-context";

type BatchAction = "stop" | "restart";

interface BatchItemResult {
  name: string;
  status: "succeeded" | "skipped_busy" | "skipped_stopped" | "failed";
  error?: string;
  activeSessions?: number;
  lastActivity?: string;
}

interface BatchResult {
  results: BatchItemResult[];
  summary: { succeeded: number; skipped: number; failed: number };
}

interface BatchActionDialogProps {
  action: BatchAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

type Phase = "preflight" | "ready" | "executing" | "done";

/** Dialog for batch stop/restart of all bots with dry-run preview and force option. */
export function BatchActionDialog({ action, open, onOpenChange, onComplete }: BatchActionDialogProps) {
  const [phase, setPhase] = useState<Phase>("preflight");
  const [dryRunResult, setDryRunResult] = useState<BatchResult | null>(null);
  const [execResult, setExecResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { authHeaders, logout } = useAuth();

  const hasBusy = dryRunResult?.results.some((r) => r.status === "skipped_busy") ?? false;
  const label = action === "stop" ? "Stop" : "Restart";

  const fetchBatch = useCallback(async (opts: { force?: boolean; idleOnly?: boolean; dryRun?: boolean; names?: string[] }) => {
    const res = await fetch("/bots/batch", {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action, ...opts }),
    });
    if (res.status === 401) {
      logout();
      setError("Session expired");
      setPhase("done");
      return null;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Request failed" }));
      throw new Error(body.error ?? "Request failed");
    }
    return res.json() as Promise<BatchResult>;
  }, [action, authHeaders, logout]);

  // Run pre-flight when dialog opens
  useEffect(() => {
    if (!open) {
      setPhase("preflight");
      setDryRunResult(null);
      setExecResult(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setPhase("preflight");
    fetchBatch({ dryRun: true }).then((result) => {
      if (cancelled || !result) return;
      setDryRunResult(result);
      setPhase("ready");
    }).catch((err) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase("ready");
    });
    return () => { cancelled = true; };
  }, [open, fetchBatch]);

  const execute = useCallback(async (opts: { force?: boolean; idleOnly?: boolean; names?: string[] }) => {
    setPhase("executing");
    setError(null);
    try {
      const result = await fetchBatch(opts);
      if (!result) return;
      setExecResult(result);
      setPhase("done");
      onComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("done");
    }
  }, [fetchBatch, onComplete]);

  const displayResult = phase === "done" ? execResult : dryRunResult;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label} All bots</AlertDialogTitle>
          <AlertDialogDescription>
            {phase === "preflight" && "Checking bot status..."}
            {phase === "ready" && `Review which bots will be ${action === "stop" ? "stopped" : "restarted"}.`}
            {phase === "executing" && `${action === "stop" ? "Stopping" : "Restarting"} bots...`}
            {phase === "done" && "Batch operation complete."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Loading spinner for preflight */}
        {phase === "preflight" && (
          <div className="flex items-center justify-center py-6">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Results table */}
        {displayResult && displayResult.results.length > 0 && (
          <div className="max-h-64 overflow-y-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {displayResult.results.map((r) => (
                  <tr key={r.name} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono">{r.name}</td>
                    <td className="px-3 py-2">
                      <StatusCell item={r} phase={phase} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {displayResult && displayResult.results.length === 0 && phase !== "preflight" && (
          <p className="text-sm text-muted-foreground text-center py-4">No bots to {action}.</p>
        )}

        {/* Error */}
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* Summary banner for done phase */}
        {phase === "done" && execResult && (
          <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
            {execResult.summary.succeeded > 0 && <span className="text-success">{execResult.summary.succeeded} succeeded</span>}
            {execResult.summary.skipped > 0 && <span className="text-muted-foreground">{execResult.summary.succeeded > 0 ? ", " : ""}{execResult.summary.skipped} skipped</span>}
            {execResult.summary.failed > 0 && <span className="text-destructive">{(execResult.summary.succeeded > 0 || execResult.summary.skipped > 0) ? ", " : ""}{execResult.summary.failed} failed</span>}
          </div>
        )}

        {/* Footer buttons */}
        <AlertDialogFooter>
          {phase === "ready" && (
            <>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              {hasBusy && (
                <Button variant="destructive" onClick={() => execute({ force: true })}>
                  Force {label} All
                </Button>
              )}
              <Button onClick={() => execute(hasBusy ? { idleOnly: true } : {})}>
                {hasBusy ? `${label} Idle Only` : `${label} All`}
              </Button>
            </>
          )}
          {phase === "executing" && (
            <Button disabled>
              <Loader2Icon className="size-4 animate-spin" />
              {action === "stop" ? "Stopping" : "Restarting"}...
            </Button>
          )}
          {phase === "done" && (
            <>
              {execResult && execResult.summary.failed > 0 && (
                <Button variant="outline" onClick={() => {
                  const failedNames = execResult.results.filter((r) => r.status === "failed").map((r) => r.name);
                  execute({ force: true, names: failedNames });
                }}>
                  Retry Failed (Force)
                </Button>
              )}
              <Button onClick={() => onOpenChange(false)}>Close</Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function StatusCell({ item, phase }: { item: BatchItemResult; phase: Phase }) {
  if (phase === "executing") {
    return <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Loader2Icon className="size-3 animate-spin" />running</span>;
  }
  if (item.status === "succeeded") {
    return <span className="inline-flex items-center gap-1.5 text-success"><CheckIcon className="size-3" />{phase === "done" ? "done" : "will proceed"}</span>;
  }
  if (item.status === "skipped_busy") {
    return (
      <span className="inline-flex items-center gap-1.5 text-warning">
        <CircleDotIcon className="size-3" />
        busy ({item.activeSessions} session{item.activeSessions === 1 ? "" : "s"})
      </span>
    );
  }
  if (item.status === "skipped_stopped") {
    return <span className="inline-flex items-center gap-1.5 text-muted-foreground">already stopped</span>;
  }
  if (item.status === "failed") {
    return <span className="inline-flex items-center gap-1.5 text-destructive"><XIcon className="size-3" />{item.error ?? "failed"}</span>;
  }
  return null;
}
