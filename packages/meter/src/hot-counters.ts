import type { CostSummary, MeterEvent, HotSnapshot, HotCounterBuckets } from "./types.js";
import { emptySummary, accumulateEvent } from "./query.js";

export type HotCounters = HotCounterBuckets;

/** Create empty hot counters for a given UTC date */
export function createHotCounters(date: string): HotCounters {
  return {
    date,
    global: { today: emptySummary(), thisMonth: emptySummary() },
    byCasa: {},
    byAuth: {},
    byTag: {},
  };
}

function ensureBucket(
  map: Record<string, { today: CostSummary; thisMonth: CostSummary }>,
  key: string,
): { today: CostSummary; thisMonth: CostSummary } {
  if (!map[key]) {
    map[key] = { today: emptySummary(), thisMonth: emptySummary() };
  }
  return map[key]!;
}

/** Ingest an event into hot counters */
export function ingestEvent(counters: HotCounters, event: MeterEvent): void {
  accumulateEvent(counters.global.today, event);
  accumulateEvent(counters.global.thisMonth, event);

  const casa = ensureBucket(counters.byCasa, event.casa);
  accumulateEvent(casa.today, event);
  accumulateEvent(casa.thisMonth, event);

  const auth = ensureBucket(counters.byAuth, event.authProfile);
  accumulateEvent(auth.today, event);
  accumulateEvent(auth.thisMonth, event);

  for (const tag of event.tags) {
    const tagBucket = ensureBucket(counters.byTag, tag);
    accumulateEvent(tagBucket.today, event);
    accumulateEvent(tagBucket.thisMonth, event);
  }
}

/** Reset today counters to zero (UTC midnight) */
export function resetToday(counters: HotCounters, newDate: string): void {
  counters.date = newDate;
  counters.global.today = emptySummary();
  for (const map of [counters.byCasa, counters.byAuth, counters.byTag]) {
    for (const bucket of Object.values(map)) {
      bucket.today = emptySummary();
    }
  }
}

/** Convert hot counters to snapshot format */
export function toSnapshot(counters: HotCounters): HotSnapshot {
  return { ts: new Date().toISOString(), ...counters };
}

/** Restore hot counters from a snapshot */
export function fromSnapshot(snapshot: HotSnapshot): HotCounters {
  return {
    date: snapshot.date,
    global: snapshot.global,
    byCasa: { ...snapshot.byCasa },
    byAuth: { ...snapshot.byAuth },
    byTag: { ...snapshot.byTag },
  };
}
