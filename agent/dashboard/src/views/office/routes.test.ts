import { describe, it, expect } from "vitest";
import { getRoute, ZONE_IDS } from "./routes";

describe("routes", () => {
  it("has routes for all 30 zone pairs", () => {
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
    const route = getRoute("desk", "phone");
    expect(route[0]).toEqual([7, 7]);
    expect(route[route.length - 1]).toEqual([12, 4]);
  });

  it("all coordinates are within 16x14 grid", () => {
    for (const from of ZONE_IDS) {
      for (const to of ZONE_IDS) {
        if (from === to) continue;
        for (const [x, y] of getRoute(from, to)) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(16);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThan(14);
        }
      }
    }
  });

  it("reverse route is the reverse of forward route", () => {
    const forward = getRoute("desk", "sofa");
    const reverse = getRoute("sofa", "desk");
    expect(reverse).toEqual([...forward].reverse());
  });
});
