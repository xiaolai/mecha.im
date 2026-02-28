import { describe, it, expect, vi, afterEach } from "vitest";
import {
  deriveSessionKey,
  createSessionToken,
  verifySessionToken,
  parseSessionCookie,
  SESSION_COOKIE,
} from "../src/lib/session.js";

describe("deriveSessionKey", () => {
  it("produces deterministic output for same input", () => {
    const key1 = deriveSessionKey("SECRET_A");
    const key2 = deriveSessionKey("SECRET_A");
    expect(key1).toBe(key2);
    expect(key1).toHaveLength(64); // 32 bytes hex
  });

  it("produces different output when OTP secret changes", () => {
    const key1 = deriveSessionKey("SECRET_A");
    const key2 = deriveSessionKey("SECRET_B");
    expect(key1).not.toBe(key2);
  });
});

describe("createSessionToken + verifySessionToken", () => {
  it("creates a valid token that can be verified", () => {
    const key = deriveSessionKey("TEST_SECRET");
    const token = createSessionToken(key, 1);
    const result = verifySessionToken(key, token);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.iat).toBeGreaterThan(0);
      expect(result.exp).toBeGreaterThan(result.iat);
    }
  });

  it("rejects expired token", () => {
    const key = deriveSessionKey("TEST_SECRET");
    // Create token with 0 TTL
    const token = createSessionToken(key, 0);
    // Token expires immediately (exp = iat + 0)
    const result = verifySessionToken(key, token);
    expect(result.valid).toBe(false);
  });

  it("rejects tampered payload", () => {
    const key = deriveSessionKey("TEST_SECRET");
    const token = createSessionToken(key, 1);
    const parts = token.split(".");
    // Tamper with payload
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    payload.exp = payload.exp + 999999;
    parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const tampered = parts.join(".");

    const result = verifySessionToken(key, tampered);
    expect(result.valid).toBe(false);
  });

  it("rejects wrong key", () => {
    const key1 = deriveSessionKey("SECRET_A");
    const key2 = deriveSessionKey("SECRET_B");
    const token = createSessionToken(key1, 1);

    const result = verifySessionToken(key2, token);
    expect(result.valid).toBe(false);
  });

  it("rejects malformed token", () => {
    const key = deriveSessionKey("TEST_SECRET");
    expect(verifySessionToken(key, "not.a.valid-token").valid).toBe(false);
    expect(verifySessionToken(key, "only-one-part").valid).toBe(false);
    expect(verifySessionToken(key, "").valid).toBe(false);
  });

  it("rejects token with invalid JSON payload", () => {
    const key = deriveSessionKey("TEST_SECRET");
    // Construct a token with invalid base64url payload
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from("not-json").toString("base64url");
    const { createHmac } = require("node:crypto");
    const sig = createHmac("sha256", Buffer.from(key, "hex")).update(`${header}.${payload}`).digest().toString("base64url");
    const token = `${header}.${payload}.${sig}`;

    const result = verifySessionToken(key, token);
    expect(result.valid).toBe(false);
  });
});

describe("SESSION_COOKIE", () => {
  it("has expected value", () => {
    expect(SESSION_COOKIE).toBe("mecha-session");
  });
});

describe("parseSessionCookie", () => {
  it("extracts session from multi-cookie header", () => {
    const header = "foo=bar; mecha-session=abc123; other=xyz";
    expect(parseSessionCookie(header)).toBe("abc123");
  });

  it("extracts session from single cookie", () => {
    expect(parseSessionCookie("mecha-session=mytoken")).toBe("mytoken");
  });

  it("returns null for missing cookie", () => {
    expect(parseSessionCookie("foo=bar; other=xyz")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parseSessionCookie(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSessionCookie("")).toBeNull();
  });

  it("handles cookie value with equals sign", () => {
    expect(parseSessionCookie("mecha-session=abc=def=ghi")).toBe("abc=def=ghi");
  });

  it("returns null for cookie with empty value", () => {
    expect(parseSessionCookie("mecha-session=")).toBeNull();
  });
});
