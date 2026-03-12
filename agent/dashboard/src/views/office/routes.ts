import type { ZoneId } from "./zones";
import { ZONES } from "./zones";
import { WALKABLE } from "./tilemap-data";
import { findPath } from "./pathfinding";

export const ZONE_IDS: ZoneId[] = ["desk", "phone", "sofa", "printer", "server", "door"];

/** Route cache — computed once on first request, then reused */
const cache = new Map<string, [number, number][]>();

export function getRoute(from: ZoneId, to: ZoneId): [number, number][] {
  if (from === to) return [[ZONES[from].tileX, ZONES[from].tileY]];

  const key = `${from}→${to}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const fromZone = ZONES[from];
  const toZone = ZONES[to];
  const path = findPath(WALKABLE, fromZone.tileX, fromZone.tileY, toZone.tileX, toZone.tileY);

  cache.set(key, path);

  // Also cache the reverse
  const reverseKey = `${to}→${from}`;
  if (!cache.has(reverseKey)) {
    cache.set(reverseKey, [...path].reverse());
  }

  return path;
}

/** Clear the route cache (useful if walkable grid or zones change) */
export function clearRouteCache(): void {
  cache.clear();
}
