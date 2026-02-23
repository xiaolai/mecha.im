import { describe, it, expect } from "vitest";
import { isValidName, NAME_PATTERN, NAME_MAX_LENGTH } from "../src/validation.js";

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
