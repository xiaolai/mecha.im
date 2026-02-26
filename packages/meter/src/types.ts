/** Unique event ID (ULID — time-sortable, no coordination needed) */
export interface MeterEvent {
  id: string;
  /** ISO-8601 timestamp of request completion */
  ts: string;

  // --- Identity (who) ---
  casa: string;
  authProfile: string;
  workspace: string;
  tags: string[];

  // --- Request (what) ---
  model: string;
  stream: boolean;

  // --- Response (result) ---
  /**
   * HTTP status code (200, 4xx, 5xx), 0 = upstream unreachable, -1 = client disconnect
   */
  status: number;
  modelActual: string;
  latencyMs: number;
  ttftMs: number | null;

  // --- Usage ---
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;

  // --- Derived ---
  costUsd: number;
}

export interface CostSummary {
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  avgLatencyMs: number;
}

export interface HotCounterBuckets {
  date: string;
  global: { today: CostSummary; thisMonth: CostSummary };
  byCasa: Record<string, { today: CostSummary; thisMonth: CostSummary }>;
  byAuth: Record<string, { today: CostSummary; thisMonth: CostSummary }>;
  byTag: Record<string, { today: CostSummary; thisMonth: CostSummary }>;
}

export interface HotSnapshot extends HotCounterBuckets {
  ts: string;
}

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheCreationPerMillion: number;
  cacheReadPerMillion: number;
}

export interface PricingTable {
  version: number;
  updatedAt: string;
  models: Record<string, ModelPricing>;
}

export interface ProxyInfo {
  port: number;
  pid: number;
  required: boolean;
  startedAt: string;
}

export interface BudgetLimit {
  dailyUsd?: number;
  monthlyUsd?: number;
}

export interface BudgetConfig {
  global: BudgetLimit;
  byCasa: Record<string, BudgetLimit>;
  byAuthProfile: Record<string, BudgetLimit>;
  byTag: Record<string, BudgetLimit>;
}

export interface HourlyRollup {
  date: string;
  hours: Array<{
    hour: number;
    total: CostSummary;
    byCasa: Record<string, CostSummary>;
    byModel: Record<string, CostSummary>;
  }>;
}

export interface DailyRollup {
  month: string;
  days: Array<{
    date: string;
    total: CostSummary;
    byCasa: Record<string, CostSummary>;
    byModel: Record<string, CostSummary>;
    byAuthProfile: Record<string, CostSummary>;
    byTag: Record<string, CostSummary>;
    byWorkspace: Record<string, CostSummary>;
  }>;
}

export interface CasaRollup {
  casa: string;
  allTime: CostSummary;
  byModel: Record<string, CostSummary>;
  byDay: Array<{ date: string; summary: CostSummary }>;
}

export interface CasaRegistryEntry {
  name: string;
  authProfile: string;
  workspace: string;
  tags: string[];
}
