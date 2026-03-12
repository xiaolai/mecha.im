import { describe, it, expect } from "vitest";
import { getRoute, ZONE_IDS } from "./routes";
import { ZONES } from "./zones";
import { WALKABLE } from "./tilemap-data";
import { MAP_COLS } from "./tilemap-data";

describe("routes (BFS)", () => {
  it("finds routes for all 30 zone pairs", () => {
    let count = 0;
    for (const from of ZONE_IDS) {
      for (const to of ZONE_IDS) {
        if (from === to) continue;
        const route = getRoute(from, to);
        expect(route.length).toBeGreaterThanOrEqual(2);
        count++;
      }
    }
    expect(count).toBe(30);
  });

  it("route starts at source zone and ends at target zone", () => {
    for (const from of ZONE_IDS) {
      for (const to of ZONE_IDS) {
        if (from === to) continue;
        const route = getRoute(from, to);
        expect(route[0]).toEqual([ZONES[from].tileX, ZONES[from].tileY]);
        expect(route[route.length - 1]).toEqual([ZONES[to].tileX, ZONES[to].tileY]);
      }
    }
  });

  it("all coordinates are within 16x14 grid and on walkable tiles", () => {
    for (const from of ZONE_IDS) {
      for (const to of ZONE_IDS) {
        if (from === to) continue;
        for (const [x, y] of getRoute(from, to)) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(16);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThan(14);
          expect(WALKABLE[y * MAP_COLS + x]).toBe(true);
        }
      }
    }
  });

  it("same-zone route returns single point", () => {
    const route = getRoute("desk", "desk");
    expect(route).toEqual([[ZONES.desk.tileX, ZONES.desk.tileY]]);
  });
});
