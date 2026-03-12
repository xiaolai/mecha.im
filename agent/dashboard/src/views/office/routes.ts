import type { ZoneId } from "./zones";
import { ZONES } from "./zones";

export const ZONE_IDS: ZoneId[] = ["desk", "phone", "sofa", "printer", "server", "door"];

type RouteKey = `${ZoneId}→${ZoneId}`;

const ROUTES: Partial<Record<RouteKey, [number, number][]>> = {
  "desk→phone":   [[7,7], [8,6], [9,5], [10,4], [12,4]],
  "desk→sofa":    [[7,7], [8,8], [9,9], [10,10], [12,11]],
  "desk→printer": [[7,7], [6,8], [5,9], [4,10], [2,11]],
  "desk→server":  [[7,7], [6,6], [5,5], [4,4], [2,4]],
  "desk→door":    [[7,7], [7,9], [7,11], [7,13]],
  "phone→sofa":    [[12,4], [12,6], [12,8], [12,10], [12,11]],
  "phone→printer": [[12,4], [10,5], [8,6], [6,8], [4,10], [2,11]],
  "phone→server":  [[12,4], [10,4], [8,4], [5,4], [2,4]],
  "phone→door":    [[12,4], [10,6], [8,8], [7,10], [7,13]],
  "sofa→printer": [[12,11], [10,11], [8,11], [5,11], [2,11]],
  "sofa→server":  [[12,11], [10,10], [8,8], [6,6], [4,5], [2,4]],
  "sofa→door":    [[12,11], [10,12], [8,13], [7,13]],
  "printer→server": [[2,11], [2,9], [2,7], [2,5], [2,4]],
  "printer→door":   [[2,11], [4,12], [6,13], [7,13]],
  "server→door": [[2,4], [4,6], [5,8], [6,10], [7,12], [7,13]],
};

// Generate reverse routes
for (const [key, route] of Object.entries(ROUTES)) {
  const [from, to] = key.split("→") as [ZoneId, ZoneId];
  const reverseKey: RouteKey = `${to}→${from}`;
  if (!ROUTES[reverseKey]) {
    ROUTES[reverseKey] = [...route].reverse();
  }
}

export function getRoute(from: ZoneId, to: ZoneId): [number, number][] {
  if (from === to) return [[ZONES[from].tileX, ZONES[from].tileY]];
  const key: RouteKey = `${from}→${to}`;
  const route = ROUTES[key];
  if (!route) {
    return [[ZONES[from].tileX, ZONES[from].tileY], [ZONES[to].tileX, ZONES[to].tileY]];
  }
  return route;
}
