import { describe, it, expect } from "vitest";
import { findPath } from "./pathfinding";

// Override MAP_COLS/MAP_ROWS for a small test grid
// The module uses imports from tilemap-data, so we test with the real grid
import { MAP_COLS, MAP_ROWS, WALKABLE } from "./tilemap-data";

describe("pathfinding", () => {
  it("finds a path between two walkable tiles", () => {
    const path = findPath(WALKABLE, 4, 4, 8, 8);
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(path[0]).toEqual([4, 4]);
    expect(path[path.length - 1]).toEqual([8, 8]);
  });

  it("returns single point for same start/end", () => {
    const path = findPath(WALKABLE, 5, 6, 5, 6);
    expect(path).toEqual([[5, 6]]);
  });

  it("all path points are on walkable tiles", () => {
    const path = findPath(WALKABLE, 1, 2, 13, 10);
    for (const [x, y] of path) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(MAP_COLS);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(MAP_ROWS);
      expect(WALKABLE[y * MAP_COLS + x]).toBe(true);
    }
  });

  it("path crosses between rooms through the opening", () => {
    // Left room (col 4) to right room (col 13) — must go through the opening
    const path = findPath(WALKABLE, 4, 4, 13, 10);
    expect(path.length).toBeGreaterThan(2);
    // At some point the path should pass through col 10-11 area (the connection)
    const passesThrough = path.some(([x]) => x >= 10 && x <= 11);
    expect(passesThrough).toBe(true);
  });

  it("simplified path has fewer points than raw BFS would produce", () => {
    // Path from (1,6) to (9,6) — should be shorter than 9 raw tiles
    const path = findPath(WALKABLE, 1, 6, 9, 6);
    expect(path.length).toBeLessThan(9);
    expect(path[0]).toEqual([1, 6]);
    expect(path[path.length - 1]).toEqual([9, 6]);
  });
});
