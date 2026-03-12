import { describe, it, expect } from "vitest";
import { extractSnippet } from "./snippet";

describe("extractSnippet", () => {
  it("centers snippet around the match", () => {
    const text = "a".repeat(100) + "NEEDLE" + "b".repeat(100);
    const result = extractSnippet(text, "needle");
    expect(result).toContain("NEEDLE");
    expect(result.startsWith("...")).toBe(true);
    expect(result.endsWith("...")).toBe(true);
  });

  it("returns start of text when needle not found", () => {
    const text = "a".repeat(200);
    const result = extractSnippet(text, "xyz");
    expect(result.length).toBe(160); // contextChars * 2
  });

  it("no ellipsis when match is at the start", () => {
    const text = "NEEDLE" + "b".repeat(200);
    const result = extractSnippet(text, "needle");
    expect(result.startsWith("...")).toBe(false);
    expect(result.endsWith("...")).toBe(true);
  });

  it("no ellipsis when match is at the end", () => {
    const text = "a".repeat(200) + "NEEDLE";
    const result = extractSnippet(text, "needle");
    expect(result.startsWith("...")).toBe(true);
    expect(result.endsWith("...")).toBe(false);
  });

  it("no ellipsis when text fits within context", () => {
    const result = extractSnippet("short text with needle here", "needle");
    expect(result).toBe("short text with needle here");
  });

  it("replaces newlines with spaces", () => {
    const result = extractSnippet("line1\nneedle\nline3", "needle");
    expect(result).not.toContain("\n");
    expect(result).toContain("line1 needle line3");
  });

  it("respects custom contextChars", () => {
    const text = "a".repeat(50) + "NEEDLE" + "b".repeat(50);
    const result = extractSnippet(text, "needle", 10);
    // 10 chars before + "NEEDLE" (6) + 10 chars after = ~26, plus "..." on both sides
    expect(result.length).toBeLessThan(40);
  });
});
