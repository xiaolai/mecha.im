import { describe, it, expect } from "vitest";
import { SeededRNG, hashString, generateDecorations } from "./room-generator";
import { WALKABLE, MAP_COLS } from "./tilemap-data";

describe("SeededRNG", () => {
  it("produces deterministic output for same seed", () => {
    const a = new SeededRNG(42);
    const b = new SeededRNG(42);
    for (let i = 0; i < 10; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it("produces different output for different seeds", () => {
    const a = new SeededRNG(1);
    const b = new SeededRNG(2);
    const aVals = Array.from({ length: 5 }, () => a.next());
    const bVals = Array.from({ length: 5 }, () => b.next());
    expect(aVals).not.toEqual(bVals);
  });

  it("int() returns values in range", () => {
    const rng = new SeededRNG(123);
    for (let i = 0; i < 100; i++) {
      const v = rng.int(0, 10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });
});

describe("hashString", () => {
  it("returns same hash for same string", () => {
    expect(hashString("test-bot")).toBe(hashString("test-bot"));
  });

  it("returns different hash for different strings", () => {
    expect(hashString("bot-a")).not.toBe(hashString("bot-b"));
  });
});

describe("generateDecorations", () => {
  it("generates decorations on walkable tiles", () => {
    const occupied = new Set<string>();
    const decos = generateDecorations(WALKABLE, "test-seed", occupied);
    expect(decos.length).toBeGreaterThan(0);
    for (const d of decos) {
      expect(WALKABLE[d.tileY * MAP_COLS + d.tileX]).toBe(true);
    }
  });

  it("avoids occupied tiles", () => {
    const occupied = new Set(["1,2", "4,4", "8,6"]);
    const decos = generateDecorations(WALKABLE, "test-seed", occupied);
    for (const d of decos) {
      expect(occupied.has(`${d.tileX},${d.tileY}`)).toBe(false);
    }
  });

  it("is deterministic for same seed", () => {
    const occupied = new Set<string>();
    const a = generateDecorations(WALKABLE, "same-seed", occupied);
    const b = generateDecorations(WALKABLE, "same-seed", occupied);
    expect(a).toEqual(b);
  });

  it("produces different decorations for different seeds", () => {
    const occupied = new Set<string>();
    const a = generateDecorations(WALKABLE, "seed-a", occupied);
    const b = generateDecorations(WALKABLE, "seed-b", occupied);
    // At least some positions should differ
    const aPositions = a.map((d) => `${d.tileX},${d.tileY}`).join(";");
    const bPositions = b.map((d) => `${d.tileX},${d.tileY}`).join(";");
    expect(aPositions).not.toBe(bPositions);
  });
});
