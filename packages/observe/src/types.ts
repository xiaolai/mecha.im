/** Structured trace for a single workflow step. */
export interface StepTrace {
  stepId: string;
  bot: string;
  status: string;
  duration?: string;
  startedAt?: string;
  completedAt?: string;
  tokens?: { input: number; output: number };
  costUsd: number;
  toolCalls?: string[];
  qualityScore?: number;
  revisionCount?: number;
  error?: string;
}

/** Structured trace for an entire workflow run. */
export interface RunTrace {
  traceId: string;
  workflow: string;
  startedAt: string;
  completedAt?: string;
  status: string;
  totalCostUsd: number;
  qualityScore?: number;
  steps: StepTrace[];
}

/** Quality score entry. */
export interface QualityScore {
  runId: string;
  stepId?: string;
  bot?: string;
  score: number;
  source: "human" | "automated" | "implicit";
  comment?: string;
  scoredAt: string;
}

/** Aggregated metrics for a bot or workflow. */
export interface MetricsSummary {
  name: string;
  type: "bot" | "workflow";
  period: { from: string; to: string };
  runCount: number;
  successRate: number;
  avgCostUsd: number;
  avgDurationMs: number;
  avgQualityScore?: number;
  revisionRate?: number;
}

/** Alert definition. */
export interface AlertRule {
  id: string;
  metric: string;
  threshold: number;
  comparison: "gt" | "lt" | "gte" | "lte";
  message: string;
}

/** Fired alert. */
export interface Alert {
  ruleId: string;
  value: number;
  message: string;
  firedAt: string;
}
