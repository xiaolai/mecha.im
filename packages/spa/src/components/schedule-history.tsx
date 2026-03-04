import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/lib/use-fetch";

interface ScheduleRunResult {
  scheduleId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  outcome: "success" | "error" | "skipped";
  error?: string;
}

interface ScheduleHistoryProps {
  botName: string;
  scheduleId: string;
  node?: string;
  refreshToken?: number;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

const outcomeBadge: Record<string, { variant: "default" | "secondary" | "destructive"; label: string }> = {
  success: { variant: "default", label: "success" },
  error: { variant: "destructive", label: "error" },
  skipped: { variant: "secondary", label: "skipped" },
};

export function ScheduleHistory({ botName, scheduleId, node, refreshToken }: ScheduleHistoryProps) {
  const nodeQuery = node && node !== "local" ? `&node=${encodeURIComponent(node)}` : "";
  const { data: runs, loading, error } = useFetch<ScheduleRunResult[]>(
    `/bots/${encodeURIComponent(botName)}/schedules/${encodeURIComponent(scheduleId)}/history?limit=10${nodeQuery}`,
    { deps: [botName, scheduleId, node, refreshToken] },
  );

  if (loading && !runs) {
    return <div className="p-4"><Skeleton className="h-16 rounded-md" /></div>;
  }

  if (error) {
    return <div className="px-4 py-3 text-xs text-destructive">{error}</div>;
  }

  if (!runs || runs.length === 0) {
    return <div className="px-4 py-3 text-xs text-muted-foreground">No runs yet.</div>;
  }

  return (
    <div className="flex flex-col divide-y divide-border">
      {runs.map((run) => {
        const badge = outcomeBadge[run.outcome] ?? outcomeBadge.error;
        const key = `${run.scheduleId}-${run.startedAt}-${run.completedAt}`;
        return (
          <div key={key} className="flex items-center gap-3 px-4 py-2 text-xs">
            <span className="text-muted-foreground w-16 shrink-0">{relativeTime(run.startedAt)}</span>
            <Badge variant={badge.variant} className="text-xs shrink-0">{badge.label}</Badge>
            <span className="font-mono text-muted-foreground shrink-0">{formatDuration(run.durationMs)}</span>
            {run.error && <span className="text-destructive truncate">{run.error}</span>}
          </div>
        );
      })}
    </div>
  );
}
