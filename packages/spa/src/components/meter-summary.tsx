import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/lib/use-fetch";

interface CostSummary {
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  avgLatencyMs: number;
}

interface CostQueryResult {
  period: string;
  total: CostSummary;
  byBot: Record<string, CostSummary>;
}

function formatUsd(n: number): string {
  return n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Renders today's metering stats (requests, cost, tokens, latency) as summary cards. */
export function MeterSummary() {
  const { data, loading, error } = useFetch<CostQueryResult>("/meter/cost", { interval: 30000 });

  if (loading && !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error ?? "Failed to load metering data"}
      </div>
    );
  }

  const { total } = data;

  return (
    <div className="grid gap-4 sm:grid-cols-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="text-xs font-medium text-muted-foreground mb-1">REQUESTS TODAY</div>
        <div className="text-xl font-semibold text-card-foreground">{total.requests}</div>
        {total.errors > 0 && (
          <div className="text-xs text-destructive">{total.errors} errors</div>
        )}
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="text-xs font-medium text-muted-foreground mb-1">COST TODAY</div>
        <div className="text-xl font-semibold text-card-foreground">{formatUsd(total.costUsd)}</div>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="text-xs font-medium text-muted-foreground mb-1">TOKENS (IN / OUT)</div>
        <div className="text-sm font-semibold text-card-foreground">
          {formatTokens(total.inputTokens)} / {formatTokens(total.outputTokens)}
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="text-xs font-medium text-muted-foreground mb-1">AVG LATENCY</div>
        <div className="text-xl font-semibold text-card-foreground">
          {total.avgLatencyMs > 0 ? `${Math.round(total.avgLatencyMs)}ms` : "—"}
        </div>
      </div>
    </div>
  );
}
