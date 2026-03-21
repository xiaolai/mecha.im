import type { RunTrace } from "./types.js";

/** Configuration variant for an A/B experiment. */
export interface ExperimentVariant {
  label: string;
  config: Record<string, unknown>;
}

/** Experiment definition. */
export interface Experiment {
  name: string;
  variantA: ExperimentVariant;
  variantB: ExperimentVariant;
  workflow: string;
  runs: number;
}

/** Aggregated metrics for one variant. */
export interface VariantMetrics {
  label: string;
  runs: number;
  avgCostUsd: number;
  avgDurationMs: number;
  avgQualityScore: number | undefined;
  successRate: number;
}

/** Result of comparing two experiment variants. */
export interface ExperimentResult {
  name: string;
  winner: "A" | "B" | "tie";
  variantA: VariantMetrics;
  variantB: VariantMetrics;
  confidence: "low" | "medium" | "high";
}

/** Executor function that runs a workflow with a given config and returns traces. */
export type ExperimentExecutor = (
  config: Record<string, unknown>,
  workflow: string,
  runs: number,
) => Promise<RunTrace[]>;

/**
 * Create an experiment definition.
 */
export function createExperiment(opts: {
  name: string;
  variantA: ExperimentVariant;
  variantB: ExperimentVariant;
  workflow: string;
  runs: number;
}): Experiment {
  if (!opts.name) throw new Error("Experiment name is required");
  if (opts.runs < 1) throw new Error("Runs must be at least 1");
  return {
    name: opts.name,
    variantA: opts.variantA,
    variantB: opts.variantB,
    workflow: opts.workflow,
    runs: opts.runs,
  };
}

/**
 * Run an experiment: execute the workflow N times with each variant config.
 * The executor is provided by the caller (requires live bots).
 */
export async function runExperiment(
  experiment: Experiment,
  executor: ExperimentExecutor,
): Promise<ExperimentResult> {
  const tracesA = await executor(
    experiment.variantA.config,
    experiment.workflow,
    experiment.runs,
  );
  const tracesB = await executor(
    experiment.variantB.config,
    experiment.workflow,
    experiment.runs,
  );

  return compareResults(experiment.name, experiment.variantA.label, tracesA, experiment.variantB.label, tracesB);
}

/**
 * Compare traces from two variants and determine a winner.
 *
 * Scoring: each metric (cost, quality, success rate) gives a point to
 * the better variant. Ties give no points. Most points wins.
 */
export function compareResults(
  experimentName: string,
  labelA: string,
  tracesA: RunTrace[],
  labelB: string,
  tracesB: RunTrace[],
): ExperimentResult {
  const metricsA = aggregateTraces(labelA, tracesA);
  const metricsB = aggregateTraces(labelB, tracesB);

  let scoreA = 0;
  let scoreB = 0;

  // Compare cost (lower is better)
  if (metricsA.avgCostUsd < metricsB.avgCostUsd) scoreA++;
  else if (metricsB.avgCostUsd < metricsA.avgCostUsd) scoreB++;

  // Compare quality (higher is better)
  const qA = metricsA.avgQualityScore ?? 0;
  const qB = metricsB.avgQualityScore ?? 0;
  if (qA > qB) scoreA++;
  else if (qB > qA) scoreB++;

  // Compare success rate (higher is better)
  if (metricsA.successRate > metricsB.successRate) scoreA++;
  else if (metricsB.successRate > metricsA.successRate) scoreB++;

  let winner: "A" | "B" | "tie";
  if (scoreA > scoreB) winner = "A";
  else if (scoreB > scoreA) winner = "B";
  else winner = "tie";

  // Confidence based on sample size
  const totalRuns = metricsA.runs + metricsB.runs;
  let confidence: "low" | "medium" | "high";
  if (totalRuns < 6) confidence = "low";
  else if (totalRuns < 20) confidence = "medium";
  else confidence = "high";

  return {
    name: experimentName,
    winner,
    variantA: metricsA,
    variantB: metricsB,
    confidence,
  };
}

/** Aggregate traces into variant metrics. */
function aggregateTraces(label: string, traces: RunTrace[]): VariantMetrics {
  if (traces.length === 0) {
    return {
      label,
      runs: 0,
      avgCostUsd: 0,
      avgDurationMs: 0,
      avgQualityScore: undefined,
      successRate: 0,
    };
  }

  const avgCost = traces.reduce((sum, t) => sum + t.totalCostUsd, 0) / traces.length;
  const successCount = traces.filter((t) => t.status === "done").length;

  const durations = traces
    .filter((t) => t.startedAt && t.completedAt)
    .map((t) => new Date(t.completedAt!).getTime() - new Date(t.startedAt).getTime());
  const avgDuration = durations.length > 0
    ? durations.reduce((sum, d) => sum + d, 0) / durations.length
    : 0;

  const qualityScores = traces
    .filter((t) => t.qualityScore != null)
    .map((t) => t.qualityScore!);
  const avgQuality = qualityScores.length > 0
    ? qualityScores.reduce((sum, q) => sum + q, 0) / qualityScores.length
    : undefined;

  return {
    label,
    runs: traces.length,
    avgCostUsd: avgCost,
    avgDurationMs: avgDuration,
    avgQualityScore: avgQuality,
    successRate: successCount / traces.length,
  };
}
