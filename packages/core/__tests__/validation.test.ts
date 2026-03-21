import { describe, it, expect } from "vitest";
import { isValidName, isValidAddress, NAME_PATTERN, NAME_MAX_LENGTH, validateTags, validateCapabilities, TAG_PATTERN, TAG_MAX_LENGTH, MAX_TAGS, parsePort } from "../src/validation.js";

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

describe("isValidAddress", () => {
  it("accepts bare names", () => {
    expect(isValidAddress("coder")).toBe(true);
  });

  it("accepts name@node format", () => {
    expect(isValidAddress("coder@alice")).toBe(true);
  });

  it("accepts hyphenated names with node", () => {
    expect(isValidAddress("my-agent@node-1")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidAddress("")).toBe(false);
  });

  it("rejects multiple @ signs", () => {
    expect(isValidAddress("a@b@c")).toBe(false);
  });

  it("rejects invalid bot part", () => {
    expect(isValidAddress("UPPER@node")).toBe(false);
  });

  it("rejects invalid node part", () => {
    expect(isValidAddress("coder@BAD")).toBe(false);
  });

  it("rejects @ only", () => {
    expect(isValidAddress("@")).toBe(false);
  });

  it("rejects empty bot before @", () => {
    expect(isValidAddress("@node")).toBe(false);
  });

  it("rejects empty node after @", () => {
    expect(isValidAddress("coder@")).toBe(false);
  });

  it("accepts wildcard '*' as valid address (R6-002)", () => {
    expect(isValidAddress("*")).toBe(true);
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

describe("parsePort", () => {
  it("returns valid port numbers", () => {
    expect(parsePort("80")).toBe(80);
    expect(parsePort("7660")).toBe(7660);
    expect(parsePort("65535")).toBe(65535);
    expect(parsePort("1")).toBe(1);
  });

  it("returns undefined for non-numeric strings", () => {
    expect(parsePort("abc")).toBeUndefined();
    expect(parsePort("")).toBeUndefined();
    expect(parsePort("foo123")).toBeUndefined();
  });

  it("returns undefined for out-of-range numbers", () => {
    expect(parsePort("0")).toBeUndefined();
    expect(parsePort("65536")).toBeUndefined();
    expect(parsePort("-1")).toBeUndefined();
  });

  it("returns undefined for non-integer numbers", () => {
    expect(parsePort("3.14")).toBeUndefined();
    expect(parsePort("80.5")).toBeUndefined();
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
