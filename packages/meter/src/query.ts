import type { MeterEvent, CostSummary } from "./types.js";
import { readEventsForDate } from "./events.js";

/** Get UTC date string for today */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Get UTC month string (YYYY-MM) for today */
export function monthUTC(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Extract month (YYYY-MM) from a date string (YYYY-MM-DD) */
export function monthFromDate(date: string): string {
  return date.slice(0, 7);
}

/** Create an empty CostSummary */
export function emptySummary(): CostSummary {
  return {
    requests: 0, errors: 0,
    inputTokens: 0, outputTokens: 0,
    cacheCreationTokens: 0, cacheReadTokens: 0,
    costUsd: 0, avgLatencyMs: 0,
  };
}

/** Accumulate an event into a CostSummary */
export function accumulateEvent(summary: CostSummary, event: MeterEvent): void {
  summary.requests++;
  if (event.status !== 200) summary.errors++;
  summary.inputTokens += event.inputTokens;
  summary.outputTokens += event.outputTokens;
  summary.cacheCreationTokens += event.cacheCreationTokens;
  summary.cacheReadTokens += event.cacheReadTokens;
  summary.costUsd += event.costUsd;
  // Running average latency
  summary.avgLatencyMs += (event.latencyMs - summary.avgLatencyMs) / summary.requests;
}

export interface CostQueryResult {
  period: string;
  total: CostSummary;
  byCasa: Record<string, CostSummary>;
}

/** Query cost from raw event files for today (initial implementation) */
export function queryCostToday(meterDir: string): CostQueryResult {
  const date = todayUTC();
  const events = readEventsForDate(meterDir, date);
  return aggregateEvents(events, `today (${date} UTC)`);
}

/** Query cost from raw event files for a specific CASA today */
export function queryCostForCasa(meterDir: string, casa: string): CostQueryResult {
  const date = todayUTC();
  const events = readEventsForDate(meterDir, date).filter(e => e.casa === casa);
  return aggregateEvents(events, `${casa} — today (${date} UTC)`);
}

/** Aggregate a list of events into a CostQueryResult */
export function aggregateEvents(events: MeterEvent[], period: string): CostQueryResult {
  const total = emptySummary();
  const byCasa: Record<string, CostSummary> = {};

  for (const event of events) {
    accumulateEvent(total, event);
    if (!byCasa[event.casa]) {
      byCasa[event.casa] = emptySummary();
    }
    accumulateEvent(byCasa[event.casa]!, event);
  }

  return { period, total, byCasa };
}
