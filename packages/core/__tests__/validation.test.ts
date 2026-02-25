import { describe, it, expect } from "vitest";
import { isValidName, NAME_PATTERN, NAME_MAX_LENGTH, validateTags, validateCapabilities, TAG_PATTERN, TAG_MAX_LENGTH, MAX_TAGS } from "../src/validation.js";

describe("isValidName", () => {
  it("accepts simple lowercase names", () => {
    expect(isValidName("researcher")).toBe(true);
  });

  it("accepts names with hyphens", () => {
    expect(isValidName("gpu-server")).toBe(true);
  });

  it("accepts single character (min length)", () => {
    expect(isValidName("a")).toBe(true);
  });

  it("accepts 32 characters (max length)", () => {
    expect(isValidName("a".repeat(32))).toBe(true);
  });

  it("accepts names with digits", () => {
    expect(isValidName("agent42")).toBe(true);
  });

  it("accepts digit-only names", () => {
    expect(isValidName("123")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidName("")).toBe(false);
  });

  it("rejects uppercase", () => {
    expect(isValidName("UPPER")).toBe(false);
  });

  it("rejects mixed case", () => {
    expect(isValidName("mixedCase")).toBe(false);
  });

  it("rejects dots", () => {
    expect(isValidName("has.dot")).toBe(false);
  });

  it("rejects @ signs", () => {
    expect(isValidName("has@at")).toBe(false);
  });

  it("rejects spaces", () => {
    expect(isValidName("has space")).toBe(false);
  });

  it("rejects leading hyphen", () => {
    expect(isValidName("-leading")).toBe(false);
  });

  it("rejects trailing hyphen", () => {
    expect(isValidName("trailing-")).toBe(false);
  });

  it("rejects names longer than 32 chars", () => {
    expect(isValidName("a".repeat(33))).toBe(false);
  });

  it("rejects underscores", () => {
    expect(isValidName("has_underscore")).toBe(false);
  });
});

describe("NAME_PATTERN", () => {
  it("is a RegExp", () => {
    expect(NAME_PATTERN).toBeInstanceOf(RegExp);
  });

  it("matches valid names", () => {
    expect(NAME_PATTERN.test("researcher")).toBe(true);
    expect(NAME_PATTERN.test("a")).toBe(true);
  });

  it("rejects invalid names", () => {
    expect(NAME_PATTERN.test("")).toBe(false);
    expect(NAME_PATTERN.test("-bad")).toBe(false);
  });
});

describe("NAME_MAX_LENGTH", () => {
  it("is 32", () => {
    expect(NAME_MAX_LENGTH).toBe(32);
  });
});

describe("validateTags", () => {
  it("accepts valid tags", () => {
    const result = validateTags(["code", "research", "ml-ops"]);
    expect(result).toEqual({ ok: true, tags: ["code", "research", "ml-ops"] });
  });

  it("normalizes to lowercase", () => {
    const result = validateTags(["CODE", "Research"]);
    expect(result).toEqual({ ok: true, tags: ["code", "research"] });
  });

  it("deduplicates tags", () => {
    const result = validateTags(["code", "Code", "CODE"]);
    expect(result).toEqual({ ok: true, tags: ["code"] });
  });

  it("rejects tags with invalid characters", () => {
    const result = validateTags(["valid", "has space"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("invalid characters");
  });

  it("rejects tags exceeding max length", () => {
    const result = validateTags(["a".repeat(33)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("1-32");
  });

  it("rejects too many tags", () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
    const result = validateTags(tags);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Too many");
  });

  it("rejects empty tag strings", () => {
    const result = validateTags([""]);
    expect(result.ok).toBe(false);
  });

  it("accepts empty array", () => {
    const result = validateTags([]);
    expect(result).toEqual({ ok: true, tags: [] });
  });
});

describe("TAG_PATTERN", () => {
  it("is a RegExp", () => {
    expect(TAG_PATTERN).toBeInstanceOf(RegExp);
  });
});

describe("TAG_MAX_LENGTH / MAX_TAGS", () => {
  it("has expected values", () => {
    expect(TAG_MAX_LENGTH).toBe(32);
    expect(MAX_TAGS).toBe(20);
  });
});

describe("validateCapabilities", () => {
  it("accepts valid capabilities", () => {
    const result = validateCapabilities(["query", "read_workspace"]);
    expect(result).toEqual({ ok: true, capabilities: ["query", "read_workspace"] });
  });

  it("accepts all valid capabilities", () => {
    const result = validateCapabilities(["query", "read_workspace", "write_workspace", "execute", "read_sessions", "lifecycle"]);
    expect(result.ok).toBe(true);
  });

  it("accepts empty array", () => {
    const result = validateCapabilities([]);
    expect(result).toEqual({ ok: true, capabilities: [] });
  });

  it("rejects invalid capability", () => {
    const result = validateCapabilities(["query", "fly"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("fly");
  });
});
