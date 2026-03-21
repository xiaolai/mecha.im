import { useState, useCallback, useRef } from "react";
import { PlusIcon, PlayIcon, PauseIcon, TrashIcon, ChevronDownIcon, ChevronRightIcon, Loader2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";
import { ScheduleAddForm } from "./schedule-add-form";
import { ScheduleHistory } from "./schedule-history";

interface ScheduleEntry {
  id: string;
  trigger: { type: string; every: string; intervalMs: number };
  prompt: string;
  paused?: boolean;
}

interface ScheduleListProps {
  botName: string;
  node?: string;
  botState?: string;
}

/** Renders a bot's schedules with add, run, pause/resume, delete actions and expandable history. */
export function ScheduleList({ botName, node, botState }: ScheduleListProps) {
  const isRunning = botState === "running" || botState === undefined;
  const nodeQuery = node && node !== "local" ? `?node=${encodeURIComponent(node)}` : "";
  const { data: schedules, loading, error, refetch } = useFetch<ScheduleEntry[]>(
    isRunning ? `/bots/${encodeURIComponent(botName)}/schedules${nodeQuery}` : null,
    { interval: 10000, deps: [botName, node, isRunning] },
  );

  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actingIds, setActingIds] = useState<Set<string>>(new Set());
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const { authHeaders, logout } = useAuth();
  // Counter bumped after "Run now" to trigger history refetch
  const historyRefreshRef = useRef(0);
  const [historyRefresh, setHistoryRefresh] = useState(0);

  const scheduleAction = useCallback(async (scheduleId: string, method: string, path: string) => {
    setActingIds((prev) => new Set(prev).add(scheduleId));
    setRowError(null);
    try {
      const res = await fetch(path, { method, headers: authHeaders, credentials: "include" });
      if (res.status === 401) { logout(); return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setRowError({ id: scheduleId, message: body.error ?? "Request failed" });
        setTimeout(() => setRowError((prev) => prev?.id === scheduleId ? null : prev), 5000);
        return;
      }
      // Bump history refresh counter when running a schedule
      if (method === "POST" && path.endsWith("/run" + nodeQuery)) {
        historyRefreshRef.current += 1;
        setHistoryRefresh(historyRefreshRef.current);
      }
      await refetch();
    } catch {
      setRowError({ id: scheduleId, message: "Connection error" });
      setTimeout(() => setRowError((prev) => prev?.id === scheduleId ? null : prev), 5000);
    } finally {
      setActingIds((prev) => {
        const next = new Set(prev);
        next.delete(scheduleId);
        return next;
      });
    }
  }, [authHeaders, logout, refetch, nodeQuery]);

  if (!isRunning) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Start the bot to manage schedules.
      </div>
    );
  }

  if (loading && !schedules) {
    return <Skeleton className="h-32 rounded-lg" />;
  }

  if (error && !schedules) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const basePath = `/bots/${encodeURIComponent(botName)}/schedules`;

  return (
    <div className="flex flex-col gap-3">
      {error && schedules && (
        <div className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
          Failed to refresh — showing last known state.
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {schedules?.length ?? 0} schedule{schedules?.length !== 1 ? "s" : ""}
        </span>
        <Button variant="outline" size="sm" className="min-h-11 sm:min-h-0" onClick={() => setShowAddForm(!showAddForm)}>
          <PlusIcon className="size-4" /> Add Schedule
        </Button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <ScheduleAddForm
          botName={botName}
          node={node}
          onAdded={() => { setShowAddForm(false); refetch(); }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Empty state */}
      {(!schedules || schedules.length === 0) && (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          No schedules yet.
        </div>
      )}

      {/* Schedule rows */}
      {schedules?.map((s) => {
        const isActing = actingIds.has(s.id);
        const isExpanded = expandedId === s.id;
        return (
          <div key={s.id} className="rounded-lg border border-border bg-card overflow-hidden">
            <div
              role="button"
              tabIndex={0}
              className="w-full p-4 text-left cursor-pointer hover:bg-accent/30 transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : s.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedId(isExpanded ? null : s.id); } }}
            >
              <div className="flex items-center gap-2">
                {isExpanded
                  ? <ChevronDownIcon className="size-4 text-muted-foreground shrink-0" />
                  : <ChevronRightIcon className="size-4 text-muted-foreground shrink-0" />}
                <span className={`size-2 rounded-full shrink-0 ${s.paused ? "bg-muted-foreground" : "bg-success"}`} />
                <span className="text-sm font-semibold font-mono truncate">{s.id}</span>
                <Badge variant="outline" className="shrink-0">every {s.trigger.every}</Badge>
                {s.paused && <Badge variant="secondary" className="shrink-0">paused</Badge>}
                <span className="flex-1" />
                {/* Action buttons */}
                <span className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <TooltipIconButton
                    tooltip="Run now"
                    variant="ghost"
                    size="icon-sm"
                    disabled={isActing}
                    onClick={() => scheduleAction(s.id, "POST", `${basePath}/${encodeURIComponent(s.id)}/run${nodeQuery}`)}
                  >
                    {isActing ? <Loader2Icon className="size-4 animate-spin" /> : <PlayIcon className="size-4" />}
                  </TooltipIconButton>
                  <TooltipIconButton
                    tooltip={s.paused ? "Resume" : "Pause"}
                    variant="ghost"
                    size="icon-sm"
                    disabled={isActing}
                    onClick={() => scheduleAction(s.id, "POST", `${basePath}/${encodeURIComponent(s.id)}/${s.paused ? "resume" : "pause"}${nodeQuery}`)}
                  >
                    <PauseIcon className="size-4" />
                  </TooltipIconButton>
                  <TooltipIconButton
                    tooltip="Delete"
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    disabled={isActing}
                    onClick={() => scheduleAction(s.id, "DELETE", `${basePath}/${encodeURIComponent(s.id)}${nodeQuery}`)}
                  >
                    <TrashIcon className="size-4" />
                  </TooltipIconButton>
                </span>
              </div>
              <div className="mt-1 ml-8 text-sm text-muted-foreground truncate">{s.prompt}</div>
            </div>
            {/* Per-row error */}
            {rowError?.id === s.id && (
              <div className="mx-4 mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {rowError.message}
              </div>
            )}
            {/* Expanded history */}
            {isExpanded && (
              <div className="border-t border-border">
                <ScheduleHistory botName={botName} scheduleId={s.id} node={node} refreshToken={historyRefresh} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
