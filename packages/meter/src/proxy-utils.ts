import type { MeterEvent, PricingTable, BudgetConfig, BotRegistryEntry, CostSummary } from "./types.js";
import type { HotCounters } from "./hot-counters.js";
import { ingestEvent } from "./hot-counters.js";
import { computeCost, resolvePricing } from "./pricing.js";
import { ulid } from "./ulid.js";
import { appendEvent } from "./events.js";
import { readBudgets, checkBudgets } from "./budgets.js";
import type { BudgetCheckResult } from "./budgets.js";
import { createLogger } from "@mecha/core";

const log = createLogger("mecha:meter");

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade",
]);

export interface ProxyContext {
  meterDir: string;
  pricing: PricingTable;
  registry: Map<string, BotRegistryEntry>;
  counters: HotCounters;
  budgets: BudgetConfig;
  /** Number of in-flight requests per bot (for budget pre-accounting). */
  pendingRequests: Map<string, number>;
}

/** Parse the bot name from the request URL path: /bot/{name}/... */
export function parseBotPath(url: string): { bot: string; upstreamPath: string } | null {
  const match = /^\/bot\/([a-z0-9-]+)(\/.*)$/.exec(url);
  if (!match) return null;
  return { bot: match[1]!, upstreamPath: match[2]! };
}

/** Build upstream headers: set Host, strip hop-by-hop (static + Connection-declared) */
export function buildUpstreamHeaders(
  incoming: Record<string, string | string[] | undefined>,
): Record<string, string> {
  // Build dynamic deny-list from Connection header tokens (RFC 7230 §6.1)
  const dynamicHop = new Set(HOP_BY_HOP);
  const connValue = incoming["connection"];
  if (connValue) {
    /* v8 ignore start -- Array.isArray branch: HTTP Connection header is always string in Node */
    const tokens = (Array.isArray(connValue) ? connValue.join(", ") : connValue);
    /* v8 ignore stop */
    for (const token of tokens.split(",")) {
      const trimmed = token.trim().toLowerCase();
      if (trimmed) dynamicHop.add(trimmed);
    }
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (dynamicHop.has(key.toLowerCase())) continue;
    if (value === undefined) continue;
    headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  headers["host"] = "api.anthropic.com";
  // Strip proxy authorization to prevent leaking proxy tokens upstream
  delete headers["authorization"];
  // Strip Accept-Encoding so upstream returns uncompressed responses.
  // The proxy needs to parse SSE text to extract token usage; compressed
  // responses are opaque binary and the SSE parser cannot read them.
  delete headers["accept-encoding"];
  return headers;
}

/** Build a MeterEvent from proxy usage data and compute cost */
export function buildMeterEvent(
  ctx: ProxyContext,
  startMs: number,
  bot: string,
  botInfo: BotRegistryEntry,
  model: string,
  stream: boolean,
  status: number,
  usage: {
    inputTokens: number; outputTokens: number;
    cacheCreationTokens: number; cacheReadTokens: number;
    modelActual: string; ttftMs: number | null;
  },
): MeterEvent {
  const pricing = resolvePricing(ctx.pricing, usage.modelActual || model);
  // Compute cost for 200 and -1 (client disconnect with partial usage consumed)
  const costUsd = (status === 200 || status === -1) ? computeCost(pricing, usage) : 0;

  return {
    id: ulid(),
    ts: new Date().toISOString(),
    bot,
    authProfile: botInfo.authProfile,
    workspace: botInfo.workspace,
    tags: botInfo.tags,
    model,
    stream,
    status,
    modelActual: usage.modelActual || model,
    latencyMs: Date.now() - startMs,
    ttftMs: usage.ttftMs,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    cacheReadTokens: usage.cacheReadTokens,
    costUsd,
  };
}

/**
 * Estimated cost per in-flight request ($0.03) for budget pre-accounting.
 * Prevents concurrent requests from bypassing budget limits.
 */
export const ESTIMATED_REQUEST_COST_USD = 0.03;

/** Run budget check for a bot request. Returns null if allowed. */
export function enforceBudget(
  ctx: ProxyContext,
  bot: string,
  botInfo: BotRegistryEntry,
): BudgetCheckResult {
  const counters = ctx.counters;
  const casaBucket = counters.byBot[bot];
  const authBucket = counters.byAuth[botInfo.authProfile];
  const tagSummaries: Record<string, { today: CostSummary; month: CostSummary }> = {};
  for (const tag of botInfo.tags) {
    const bucket = counters.byTag[tag];
    if (bucket) tagSummaries[tag] = { today: bucket.today, month: bucket.thisMonth };
  }

  // Add estimated cost for in-flight requests to prevent concurrent budget bypass
  const pending = ctx.pendingRequests.get(bot) ?? 0;
  const pendingCostUsd = pending * ESTIMATED_REQUEST_COST_USD;

  return checkBudgets({
    config: ctx.budgets,
    bot,
    authProfile: botInfo.authProfile,
    tags: botInfo.tags,
    global: { today: counters.global.today, month: counters.global.thisMonth },
    perBot: casaBucket ? { today: casaBucket.today, month: casaBucket.thisMonth } : undefined,
    perAuth: authBucket ? { today: authBucket.today, month: authBucket.thisMonth } : undefined,
    perTag: tagSummaries,
    pendingCostUsd,
  });
}

/** Reload budgets from disk (called on SIGHUP) */
export function reloadBudgets(ctx: ProxyContext): void {
  ctx.budgets = readBudgets(ctx.meterDir);
}

/** Counter for events that failed to persist (observable via snapshot and logs). */
let droppedEvents = 0;

/** Get the number of dropped events since process start. */
export function getDroppedEventCount(): number {
  return droppedEvents;
}

/** Reset dropped event counter (for testing). */
export function resetDroppedEventCount(): void {
  droppedEvents = 0;
}

/** Record a meter event: append to disk + update hot counters (skips ingest on persist failure) */
export function recordEvent(ctx: ProxyContext, event: MeterEvent): void {
  try {
    appendEvent(ctx.meterDir, event);
    ingestEvent(ctx.counters, event);
  /* v8 ignore start -- disk write failure logging */
  } catch (err) {
    droppedEvents++;
    log.error("Failed to write event", { eventId: event.id, droppedEvents, error: err instanceof Error ? err.message : String(err) });
  }
  /* v8 ignore stop */
}

/** Max request body size (32 MB) to prevent memory DoS */
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

/** Max response body size (128 MB) to prevent memory DoS on non-stream responses */
export const MAX_RESPONSE_BYTES = 128 * 1024 * 1024;

/** Extract model name and stream flag from a request body JSON. */
export function parseModelAndStream(body: Buffer): { model: string; stream: boolean } {
  try {
    const parsed = JSON.parse(body.toString()) as Record<string, unknown>;
    return {
      model: (typeof parsed.model === "string" ? parsed.model : ""),
      stream: (typeof parsed.stream === "boolean" ? parsed.stream : false),
    };
  } catch {
    return { model: "", stream: false };
  }
}

/** Strip hop-by-hop headers from upstream response headers (case-insensitive + Connection-declared). */
export function stripHopByHop(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  // Build dynamic deny-list from Connection header tokens (RFC 7230 §6.1)
  const deny = new Set(HOP_BY_HOP);
  const connValue = headers["connection"];
  if (connValue) {
    /* v8 ignore start -- Array.isArray branch: HTTP Connection header is always string */
    const tokens = Array.isArray(connValue) ? connValue.join(", ") : connValue;
    /* v8 ignore stop */
    for (const token of tokens.split(",")) {
      const trimmed = token.trim().toLowerCase();
      if (trimmed) deny.add(trimmed);
    }
  }
  const out: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!deny.has(key.toLowerCase())) {
      out[key] = value;
    }
  }
  return out;
}
