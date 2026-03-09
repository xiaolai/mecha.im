import { useState, useCallback, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { PlayIcon, PauseIcon, TrashIcon, Loader2Icon, CalendarClockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";

// Mirrors ScheduleOverviewEntry from @mecha/agent routes/schedule-overview.ts
interface OverviewEntry {
  botName: string;
  node: string;
  scheduleId: string;
  every: string;
  prompt: string;
  paused: boolean;
}

type ActionType = "run" | "pause" | "resume" | "delete";

/** Renders a cross-bot schedule overview table with run, pause/resume, and delete actions. */
export function ScheduleOverview() {
  const { data: schedules, loading, error, refetch } = useFetch<OverviewEntry[]>(
    "/bots/schedules/overview",
    { interval: 10000 },
  );

  // Fix #7: Track which action is in-flight per row
  const [actingActions, setActingActions] = useState<Map<string, ActionType>>(new Map());
  const [rowError, setRowError] = useState<{ key: string; message: string } | null>(null);
  const { authHeaders, logout } = useAuth();

  // Fix #8: Track timeout handles for cleanup on unmount
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  const scheduleAction = useCallback(async (
    botName: string,
    scheduleId: string,
    method: string,
    actionPath: string,
    action: ActionType,
  ) => {
    const key = `${botName}/${scheduleId}`;
    setActingActions((prev) => new Map(prev).set(key, action));
    setRowError(null);
    if (errorTimerRef.current) { clearTimeout(errorTimerRef.current); errorTimerRef.current = null; }
    try {
      const res = await fetch(
        `/bots/${encodeURIComponent(botName)}/schedules/${encodeURIComponent(scheduleId)}${actionPath}`,
        { method, headers: authHeaders, credentials: "include" },
      );
      if (res.status === 401) { logout(); return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setRowError({ key, message: body.error ?? "Request failed" });
        errorTimerRef.current = setTimeout(() => setRowError((prev) => prev?.key === key ? null : prev), 5000);
        return;
      }
      await refetch();
    } catch {
      setRowError({ key, message: "Connection error" });
      errorTimerRef.current = setTimeout(() => setRowError((prev) => prev?.key === key ? null : prev), 5000);
    } finally {
      setActingActions((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    }
  }, [authHeaders, logout, refetch]);

  if (loading && !schedules) {
    return <Skeleton className="h-32 rounded-lg" />;
  }

  // Fix #6: Show stale data with non-blocking error banner instead of replacing the table
  const showData = schedules && schedules.length > 0;

  if (error && !showData) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!showData) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <CalendarClockIcon className="mx-auto size-8 text-muted-foreground/50" />
        <p className="mt-3 text-sm text-muted-foreground">
          No schedules across any bot. Add schedules from a bot&apos;s detail page.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Fix #6: Non-blocking polling error banner */}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
          Polling error: {error}. Showing last known data.
        </div>
      )}

      <span className="text-sm text-muted-foreground">
        {schedules.length} schedule{schedules.length !== 1 ? "s" : ""} across{" "}
        {new Set(schedules.map((s) => s.botName)).size} bot{new Set(schedules.map((s) => s.botName)).size !== 1 ? "s" : ""}
      </span>

      {/* Table header — hidden on mobile */}
      <div className="hidden sm:grid sm:grid-cols-[1fr_auto_1fr_auto_auto] sm:gap-3 sm:px-4 sm:py-2 sm:text-xs sm:font-medium sm:text-muted-foreground">
        <span>Bot</span>
        <span>Interval</span>
        <span>Prompt</span>
        <span>Status</span>
        <span>Actions</span>
      </div>

      {schedules.map((s) => {
        const key = `${s.botName}/${s.scheduleId}`;
        const activeAction = actingActions.get(key);
        const isActing = activeAction !== undefined;
        return (
          <div key={key} className="rounded-lg border border-border bg-card">
            <div className="flex flex-col gap-2 p-4 sm:grid sm:grid-cols-[1fr_auto_1fr_auto_auto] sm:items-center sm:gap-3">
              {/* Bot name */}
              <div className="flex items-center gap-2 min-w-0">
                <span className={`size-2 rounded-full shrink-0 ${s.paused ? "bg-muted-foreground" : "bg-success"}`} />
                <Link
                  to={`/bot/${encodeURIComponent(s.botName)}`}
                  className="truncate text-sm font-semibold text-foreground hover:text-primary transition-colors"
                >
                  {s.botName}
                </Link>
                <span className="text-xs font-mono text-muted-foreground truncate">{s.scheduleId}</span>
              </div>

              {/* Interval */}
              <Badge variant="outline" className="shrink-0 w-fit">every {s.every}</Badge>

              {/* Prompt */}
              <span className="text-sm text-muted-foreground truncate min-w-0">{s.prompt}</span>

              {/* Status */}
              <Badge
                variant="secondary"
                className={`shrink-0 w-fit ${s.paused ? "" : "bg-success/15 text-success"}`}
              >
                {s.paused ? "paused" : "active"}
              </Badge>

              {/* Actions — Fix #7: spinner shows on the button whose action is in-flight */}
              <span className="flex items-center gap-1 shrink-0">
                <TooltipIconButton
                  tooltip="Run now"
                  variant="ghost"
                  size="icon-sm"
                  disabled={isActing}
                  onClick={() => scheduleAction(s.botName, s.scheduleId, "POST", "/run", "run")}
                >
                  {activeAction === "run" ? <Loader2Icon className="size-4 animate-spin" /> : <PlayIcon className="size-4" />}
                </TooltipIconButton>
                <TooltipIconButton
                  tooltip={s.paused ? "Resume" : "Pause"}
                  variant="ghost"
                  size="icon-sm"
                  disabled={isActing}
                  onClick={() => scheduleAction(s.botName, s.scheduleId, "POST", s.paused ? "/resume" : "/pause", s.paused ? "resume" : "pause")}
                >
                  {activeAction === "pause" || activeAction === "resume" ? <Loader2Icon className="size-4 animate-spin" /> : <PauseIcon className="size-4" />}
                </TooltipIconButton>
                <TooltipIconButton
                  tooltip="Delete"
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:text-destructive"
                  disabled={isActing}
                  onClick={() => scheduleAction(s.botName, s.scheduleId, "DELETE", "", "delete")}
                >
                  {activeAction === "delete" ? <Loader2Icon className="size-4 animate-spin" /> : <TrashIcon className="size-4" />}
                </TooltipIconButton>
              </span>
            </div>

            {/* Per-row error — Fix #9: add role="alert" for screen readers */}
            {rowError?.key === key && (
              <div role="alert" className="mx-4 mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {rowError.message}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
