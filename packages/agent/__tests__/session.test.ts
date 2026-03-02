import { describe, it, expect, vi, afterEach } from "vitest";
import { deriveSessionKey, createSessionToken, verifySessionToken, parseSessionCookie } from "../src/session.js";

describe("session", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  describe("deriveSessionKey", () => {
    it("produces a 64-char hex string", () => {
      const key = deriveSessionKey("JBSWY3DPEHPK3PXP");
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it("produces deterministic output", () => {
      const a = deriveSessionKey("SAME_SECRET");
      const b = deriveSessionKey("SAME_SECRET");
      expect(a).toBe(b);
    });

    it("produces different keys for different secrets", () => {
      const a = deriveSessionKey("SECRET_A");
      const b = deriveSessionKey("SECRET_B");
      expect(a).not.toBe(b);
    });
  });

  describe("createSessionToken + verifySessionToken", () => {
    it("creates a valid token that can be verified", () => {
      const key = deriveSessionKey("TESTSECRET");
      const token = createSessionToken(key, 1);
      const result = verifySessionToken(key, token);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.exp).toBeGreaterThan(result.iat);
      }
    });

    it("rejects token with wrong key", () => {
      const key1 = deriveSessionKey("KEY1");
      const key2 = deriveSessionKey("KEY2");
      const token = createSessionToken(key1, 1);
      expect(verifySessionToken(key2, token).valid).toBe(false);
    });

    it("rejects expired token", () => {
      const key = deriveSessionKey("TESTSECRET");
      // Create token with 0 TTL → expires immediately
      vi.spyOn(Date, "now").mockReturnValue(Date.now() - 7200_000);
      const token = createSessionToken(key, 1);
      vi.restoreAllMocks();
      expect(verifySessionToken(key, token).valid).toBe(false);
    });

    it("rejects malformed tokens", () => {
      const key = deriveSessionKey("TESTSECRET");
      expect(verifySessionToken(key, "not.a.jwt").valid).toBe(false);
      expect(verifySessionToken(key, "only-one-part").valid).toBe(false);
      expect(verifySessionToken(key, "a.b.c.d").valid).toBe(false);
    });

    it("rejects token with tampered payload", () => {
      const key = deriveSessionKey("TESTSECRET");
      const token = createSessionToken(key, 1);
      const parts = token.split(".");
      // Tamper the payload
      parts[1] = Buffer.from(JSON.stringify({ iat: 0, exp: 9999999999 })).toString("base64url");
      expect(verifySessionToken(key, parts.join(".")).valid).toBe(false);
    });
  });

  describe("parseSessionCookie", () => {
    it("returns null for null input", () => {
      expect(parseSessionCookie(null)).toBeNull();
    });

    it("extracts mecha-session value", () => {
      expect(parseSessionCookie("mecha-session=abc123; other=xyz")).toBe("abc123");
    });

    it("returns null when cookie not present", () => {
      expect(parseSessionCookie("other=xyz")).toBeNull();
    });

    it("handles cookie value with = signs", () => {
      expect(parseSessionCookie("mecha-session=a.b.c=")).toBe("a.b.c=");
    });

    it("returns null for empty value", () => {
      expect(parseSessionCookie("mecha-session=")).toBeNull();
    });
  });
});
