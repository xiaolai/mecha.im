import { describe, it, expect } from "vitest";
import { safeCompare } from "../src/safe-compare.js";

describe("safeCompare", () => {
  it("returns true for identical strings", () => {
    expect(safeCompare("secret", "secret")).toBe(true);
  });

  it("returns false for different strings of same length", () => {
    expect(safeCompare("abcdef", "abcdeg")).toBe(false);
  });

  it("returns false for strings of different lengths", () => {
    expect(safeCompare("short", "longer-string")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(safeCompare("", "")).toBe(true);
  });

  it("handles unicode strings", () => {
    expect(safeCompare("mecha_日本語", "mecha_日本語")).toBe(true);
    expect(safeCompare("mecha_日本語", "mecha_中文字")).toBe(false);
  });
});
