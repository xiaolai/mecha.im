import type { RunTrace, MetricsSummary } from "./types.js";

/**
 * Compute aggregated metrics from a list of traces.
 * Groups by bot or workflow depending on the `by` parameter.
 */
export function computeMetrics(
  traces: RunTrace[],
  opts: { by: "bot" | "workflow"; name: string },
): MetricsSummary | null {
  if (traces.length === 0) return null;

  const now = new Date().toISOString();

  if (opts.by === "workflow") {
    const filtered = traces.filter((t) => t.workflow === opts.name);
    if (filtered.length === 0) return null;
    const earliest = filtered.reduce(
      (min, t) => (t.startedAt < min ? t.startedAt : min),
      filtered[0]!.startedAt,
    );

    const successCount = filtered.filter((t) => t.status === "done").length;
    const avgCost = filtered.reduce((sum, t) => sum + t.totalCostUsd, 0) / filtered.length;
    const durations = filtered
      .filter((t) => t.startedAt && t.completedAt)
      .map((t) => new Date(t.completedAt!).getTime() - new Date(t.startedAt).getTime());
    const avgDuration = durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : 0;
    const qualityScores = filtered.filter((t) => t.qualityScore != null).map((t) => t.qualityScore!);
    const avgQuality = qualityScores.length > 0
      ? qualityScores.reduce((sum, q) => sum + q, 0) / qualityScores.length
      : undefined;

    return {
      name: opts.name,
      type: "workflow",
      period: { from: earliest, to: now },
      runCount: filtered.length,
      successRate: successCount / filtered.length,
      avgCostUsd: avgCost,
      avgDurationMs: avgDuration,
      avgQualityScore: avgQuality,
    };
  }

  // by bot: aggregate across all traces, looking at step-level data
  const botSteps = traces.flatMap((t) => t.steps.filter((s) => s.bot === opts.name));
  if (botSteps.length === 0) return null;
  const earliest = botSteps.reduce(
    (min, s) => (s.startedAt && s.startedAt < min ? s.startedAt : min),
    botSteps.find((s) => s.startedAt)?.startedAt ?? now,
  );

  const completed = botSteps.filter((s) => s.status === "completed");
  const avgCost = botSteps.reduce((sum, s) => sum + s.costUsd, 0) / botSteps.length;
  const durations = botSteps
    .filter((s) => s.startedAt && s.completedAt)
    .map((s) => new Date(s.completedAt!).getTime() - new Date(s.startedAt!).getTime());
  const avgDuration = durations.length > 0
    ? durations.reduce((sum, d) => sum + d, 0) / durations.length
    : 0;
  const qualityScores = botSteps.filter((s) => s.qualityScore != null).map((s) => s.qualityScore!);
  const avgQuality = qualityScores.length > 0
    ? qualityScores.reduce((sum, q) => sum + q, 0) / qualityScores.length
    : undefined;
  const revisionSteps = botSteps.filter((s) => (s.revisionCount ?? 0) > 0);

  return {
    name: opts.name,
    type: "bot",
    period: { from: earliest, to: now },
    runCount: botSteps.length,
    successRate: completed.length / botSteps.length,
    avgCostUsd: avgCost,
    avgDurationMs: avgDuration,
    avgQualityScore: avgQuality,
    /* v8 ignore start -- unreachable: botSteps.length === 0 already returns null above */
    revisionRate:
      botSteps.length > 0 ? revisionSteps.length / botSteps.length : 0,
    /* v8 ignore stop */
  };
}
