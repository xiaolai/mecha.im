/** Step definition in a workflow YAML. */
export interface StepDef {
  bot: string;
  prompt: string;
  depends?: string[];
  condition?: string;
  compensate?: string;
  output?: string;
  outputSchema?: Record<string, unknown>;
  timeout?: string;
  budgetUsd?: number;
  gate?: "human";
}

/** Workflow definition parsed from YAML. */
export interface WorkflowDef {
  name: string;
  description?: string;
  trigger?: {
    schedule?: string;
    topic?: string;
    webhook?: string;
    manual?: boolean;
  };
  inputs?: Record<string, { type: string; default?: unknown }>;
  budgetUsd?: number;
  steps: Record<string, StepDef>;
  outputs?: Record<string, string>;
}

/** Status of a single step in a run. */
export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "waiting"       // gate
  | "compensating"
  | "compensated";

/** Runtime state for a single step. */
export interface StepState {
  status: StepStatus;
  stepRunId: string;
  startedAt?: string;
  completedAt?: string;
  output?: unknown;
  error?: string;
  attempts: number;
  costUsd?: number;
  gateApproved?: boolean;
}

/** Status of an entire workflow run. */
export type RunStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "waiting"       // gate
  | "compensating"
  | "compensated"
  | "cancelled";

/** Persistent state for a workflow run. */
export interface RunState {
  runId: string;
  workflow: string;
  status: RunStatus;
  inputs: Record<string, unknown>;
  steps: Record<string, StepState>;
  startedAt: string;
  completedAt?: string;
  totalCostUsd: number;
}

/** Function that executes a step (sends prompt to a bot, returns result). */
export type StepExecutor = (opts: {
  bot: string;
  prompt: string;
  stepRunId: string;
  timeout?: string;
  budgetUsd?: number;
}) => Promise<{ output: unknown; costUsd?: number }>;
