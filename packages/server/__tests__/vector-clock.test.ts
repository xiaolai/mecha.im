import { describe, it, expect } from "vitest";
import { increment, merge, isNewer, diff } from "../src/vector-clock.js";

describe("vector-clock", () => {
  describe("increment", () => {
    it("creates new key starting at 1", () => {
      const result = increment({}, "a");
      expect(result).toEqual({ a: 1 });
    });

    it("increments existing key", () => {
      const result = increment({ a: 3 }, "a");
      expect(result).toEqual({ a: 4 });
    });

    it("does not mutate original", () => {
      const original = { a: 1 };
      const result = increment(original, "a");
      expect(original.a).toBe(1);
      expect(result.a).toBe(2);
    });
  });

  describe("merge", () => {
    it("takes max of each key", () => {
      const result = merge({ a: 3, b: 1 }, { a: 1, b: 5, c: 2 });
      expect(result).toEqual({ a: 3, b: 5, c: 2 });
    });

    it("handles disjoint clocks", () => {
      const result = merge({ a: 1 }, { b: 2 });
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("handles empty clocks", () => {
      expect(merge({}, {})).toEqual({});
      expect(merge({ a: 1 }, {})).toEqual({ a: 1 });
    });
  });

  describe("isNewer", () => {
    it("returns true when a is ahead", () => {
      expect(isNewer({ a: 2 }, { a: 1 })).toBe(true);
    });

    it("returns false when equal", () => {
      expect(isNewer({ a: 1 }, { a: 1 })).toBe(false);
    });

    it("returns false when behind", () => {
      expect(isNewer({ a: 1 }, { a: 2 })).toBe(false);
    });

    it("returns true with new key", () => {
      expect(isNewer({ a: 1, b: 1 }, { a: 1 })).toBe(true);
    });

    it("handles empty clocks", () => {
      expect(isNewer({}, {})).toBe(false);
      expect(isNewer({ a: 1 }, {})).toBe(true);
    });
  });

  describe("diff", () => {
    it("returns server IDs where local is ahead", () => {
      const result = diff({ a: 3, b: 1, c: 5 }, { a: 3, b: 2, c: 3 });
      expect(result).toEqual(["c"]);
    });

    it("returns empty when not ahead", () => {
      expect(diff({ a: 1 }, { a: 2 })).toEqual([]);
    });

    it("includes new keys", () => {
      expect(diff({ a: 1, b: 1 }, { a: 1 })).toEqual(["b"]);
    });
  });
});
