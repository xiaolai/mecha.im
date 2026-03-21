import { describe, it, expect } from "vitest";
import { deriveSessionKey, createSessionToken, validateSessionToken } from "../src/session.js";

const TEST_SECRET = "JBSWY3DPEHPK3PXP";

describe("deriveSessionKey", () => {
  it("returns a 32-byte Uint8Array", () => {
    const key = deriveSessionKey(TEST_SECRET);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it("is deterministic for the same secret", () => {
    const a = deriveSessionKey(TEST_SECRET);
    const b = deriveSessionKey(TEST_SECRET);
    expect(Buffer.from(a).toString("hex")).toBe(Buffer.from(b).toString("hex"));
  });

  it("produces different keys for different secrets", () => {
    const a = deriveSessionKey("SECRET_A");
    const b = deriveSessionKey("SECRET_B");
    expect(Buffer.from(a).toString("hex")).not.toBe(Buffer.from(b).toString("hex"));
  });
});

describe("createSessionToken", () => {
  it("returns a hex string", () => {
    const key = deriveSessionKey(TEST_SECRET);
    const token = createSessionToken(key, 1);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for the same key and counter", () => {
    const key = deriveSessionKey(TEST_SECRET);
    const a = createSessionToken(key, 1);
    const b = createSessionToken(key, 1);
    expect(a).toBe(b);
  });

  it("produces different tokens for different counters", () => {
    const key = deriveSessionKey(TEST_SECRET);
    const a = createSessionToken(key, 0);
    const b = createSessionToken(key, 1);
    expect(a).not.toBe(b);
  });
});

describe("validateSessionToken", () => {
  it("accepts a token created with counter=1", () => {
    const key = deriveSessionKey(TEST_SECRET);
    const token = createSessionToken(key, 1);
    expect(validateSessionToken(TEST_SECRET, token)).toBe(true);
  });

  it("accepts tokens within the sliding window (0..4)", () => {
    const key = deriveSessionKey(TEST_SECRET);
    for (let counter = 0; counter <= 4; counter++) {
      const token = createSessionToken(key, counter);
      expect(validateSessionToken(TEST_SECRET, token)).toBe(true);
    }
  });

  it("rejects a token outside the window", () => {
    const key = deriveSessionKey(TEST_SECRET);
    const token = createSessionToken(key, 99);
    expect(validateSessionToken(TEST_SECRET, token)).toBe(false);
  });

  it("rejects a garbage token", () => {
    expect(validateSessionToken(TEST_SECRET, "deadbeef")).toBe(false);
  });

  it("rejects a token from a different secret", () => {
    const otherKey = deriveSessionKey("OTHER_SECRET");
    const token = createSessionToken(otherKey, 1);
    expect(validateSessionToken(TEST_SECRET, token)).toBe(false);
  });
});
