/** Unique event ID (ULID — time-sortable, no coordination needed) */
export interface MeterEvent {
  id: string;
  /** ISO-8601 timestamp of request completion */
  ts: string;

  // --- Identity (who) ---
  bot: string;
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

/** Aggregated cost and usage statistics for a set of meter events */
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

/** In-memory cost summaries bucketed by date, bot, auth profile, and tag */
export interface HotCounterBuckets {
  date: string;
  global: { today: CostSummary; thisMonth: CostSummary };
  byBot: Record<string, { today: CostSummary; thisMonth: CostSummary }>;
  byAuth: Record<string, { today: CostSummary; thisMonth: CostSummary }>;
  byTag: Record<string, { today: CostSummary; thisMonth: CostSummary }>;
}

/** Timestamped snapshot of HotCounterBuckets for API responses */
export interface HotSnapshot extends HotCounterBuckets {
  ts: string;
  droppedEvents?: number;
}

/** Per-million-token pricing rates for a single model */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheCreationPerMillion: number;
  cacheReadPerMillion: number;
}

/** Versioned lookup table mapping model names to their pricing rates */
export interface PricingTable {
  version: number;
  updatedAt: string;
  models: Record<string, ModelPricing>;
}

/** Persisted metadata about a running meter proxy process */
export interface ProxyInfo {
  port: number;
  pid: number;
  required: boolean;
  startedAt: string;
}

/** Optional daily and monthly USD spending caps */
export interface BudgetLimit {
  dailyUsd?: number;
  monthlyUsd?: number;
}

/** Budget limits organized by scope: global, per-bot, per-auth-profile, and per-tag */
export interface BudgetConfig {
  global: BudgetLimit;
  byBot: Record<string, BudgetLimit>;
  byAuthProfile: Record<string, BudgetLimit>;
  byTag: Record<string, BudgetLimit>;
}

/** Per-hour cost breakdown for a single UTC date */
export interface HourlyRollup {
  date: string;
  hours: Array<{
    hour: number;
    total: CostSummary;
    byBot: Record<string, CostSummary>;
    byModel: Record<string, CostSummary>;
  }>;
}

/** Per-day cost breakdown for a single UTC month */
export interface DailyRollup {
  month: string;
  days: Array<{
    date: string;
    total: CostSummary;
    byBot: Record<string, CostSummary>;
    byModel: Record<string, CostSummary>;
    byAuthProfile: Record<string, CostSummary>;
    byTag: Record<string, CostSummary>;
    byWorkspace: Record<string, CostSummary>;
  }>;
}

/** All-time and per-day cost breakdown for a single bot */
export interface BotRollup {
  bot: string;
  allTime: CostSummary;
  byModel: Record<string, CostSummary>;
  byDay: Array<{ date: string; summary: CostSummary }>;
}

/** Bot identity metadata used for event attribution and budget lookups */
export interface BotRegistryEntry {
  name: string;
  authProfile: string;
  workspace: string;
  tags: string[];
}
