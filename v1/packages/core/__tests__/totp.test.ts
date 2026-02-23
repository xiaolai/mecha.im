import { describe, it, expect, vi, afterEach } from "vitest";
import { verifyTotp, generateTotp } from "../src/totp.js";

// A well-known base32 secret for testing
const SECRET = "JBSWY3DPEHPK3PXP"; // decodes to "Hello!"

describe("generateTotp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a 6-digit string", () => {
    const code = generateTotp(SECRET);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("is deterministic for the same time step", () => {
    const now = 1700000000000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const code1 = generateTotp(SECRET);
    const code2 = generateTotp(SECRET);
    expect(code1).toBe(code2);
  });

  it("produces different codes for different time steps", () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const code1 = generateTotp(SECRET);
    vi.spyOn(Date, "now").mockReturnValue(1700000060000); // +60s = different step
    const code2 = generateTotp(SECRET);
    expect(code1).not.toBe(code2);
  });

  it("throws on invalid base32 input", () => {
    expect(() => generateTotp("!!!invalid!!!")).toThrow("Invalid base32 character");
  });
});

describe("verifyTotp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a valid code for the current time step", () => {
    const code = generateTotp(SECRET);
    expect(verifyTotp(SECRET, code)).toBe(true);
  });

  it("accepts a code from the previous time step (window = -1)", () => {
    const now = 1700000030000; // step boundary
    vi.spyOn(Date, "now").mockReturnValue(now);
    const currentCode = generateTotp(SECRET);

    // Move time forward by one step
    vi.spyOn(Date, "now").mockReturnValue(now + 30000);
    expect(verifyTotp(SECRET, currentCode)).toBe(true);
  });

  it("accepts a code from the next time step (window = +1)", () => {
    const now = 1700000030000;
    vi.spyOn(Date, "now").mockReturnValue(now + 30000);
    const futureCode = generateTotp(SECRET);

    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(verifyTotp(SECRET, futureCode)).toBe(true);
  });

  it("rejects a code that is not 6 digits", () => {
    expect(verifyTotp(SECRET, "12345")).toBe(false);
    expect(verifyTotp(SECRET, "1234567")).toBe(false);
    expect(verifyTotp(SECRET, "abcdef")).toBe(false);
    expect(verifyTotp(SECRET, "")).toBe(false);
  });

  it("rejects an invalid code", () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const code = generateTotp(SECRET);
    // Flip the last digit
    const bad = code.slice(0, 5) + String((Number(code[5]) + 1) % 10);
    // Move time far away so bad code is outside window
    vi.spyOn(Date, "now").mockReturnValue(1700000000000 + 90000);
    expect(verifyTotp(SECRET, bad)).toBe(false);
  });

  it("returns false for an invalid base32 secret", () => {
    expect(verifyTotp("!!!bad!!!", "123456")).toBe(false);
  });
});
