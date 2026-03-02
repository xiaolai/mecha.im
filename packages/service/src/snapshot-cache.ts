import { readSnapshot } from "@mecha/meter";
import type { HotSnapshot } from "@mecha/meter";

const CACHE_TTL_MS = 5_000;

let cached: HotSnapshot | null = null;
let cachedAt = 0;
let cachedDir = "";

/** Read snapshot with in-memory cache (5s TTL). Avoids sync disk I/O on every request. */
export function getCachedSnapshot(meterDir: string): HotSnapshot | null {
  const now = Date.now();
  if (cachedDir === meterDir && now - cachedAt < CACHE_TTL_MS) return cached;
  cached = readSnapshot(meterDir);
  cachedAt = now;
  cachedDir = meterDir;
  return cached;
}

/** Invalidate the cache (for testing or manual refresh). */
export function invalidateSnapshotCache(): void {
  cached = null;
  cachedAt = 0;
  cachedDir = "";
}
