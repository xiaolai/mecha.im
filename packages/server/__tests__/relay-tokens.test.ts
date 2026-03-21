import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { createRelayToken, validateRelayToken } from "../src/relay-tokens.js";

const secret = randomBytes(32);

describe("relay-tokens", () => {
  describe("createRelayToken", () => {
    it("produces a dot-separated base64url string", () => {
      const token = createRelayToken(secret, { peer: "alice", srv: "srv1" });
      expect(token).toContain(".");
      const [payloadB64, hmacB64] = token.split(".");
      // Both parts should be valid base64url
      expect(Buffer.from(payloadB64!, "base64url").length).toBeGreaterThan(0);
      expect(Buffer.from(hmacB64!, "base64url").length).toBe(32); // SHA-256 = 32 bytes
    });

    it("embeds peer and srv in the payload", () => {
      const token = createRelayToken(secret, { peer: "bob", srv: "my-server" });
      const payloadB64 = token.split(".")[0]!;
      const parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
      expect(parsed.peer).toBe("bob");
      expect(parsed.srv).toBe("my-server");
      expect(parsed.nonce).toMatch(/^[0-9a-f]{32}$/);
      expect(typeof parsed.exp).toBe("number");
    });
  });

  describe("validateRelayToken", () => {
    it("succeeds on a valid token", () => {
      const token = createRelayToken(secret, { peer: "alice", srv: "s1" });
      const result = validateRelayToken(secret, token);
      expect(result).toBeDefined();
      expect(result!.peer).toBe("alice");
      expect(result!.srv).toBe("s1");
    });

    it("rejects expired token", () => {
      // Manually craft an expired token
      const payload = JSON.stringify({
        peer: "alice",
        nonce: randomBytes(16).toString("hex"),
        exp: Math.floor(Date.now() / 1000) - 10, // 10 seconds ago
        srv: "s1",
      });
      const payloadB64 = Buffer.from(payload).toString("base64url");
      const { createHmac } = require("node:crypto");
      const hmac = createHmac("sha256", secret).update(payloadB64).digest().toString("base64url");
      const token = `${payloadB64}.${hmac}`;

      const result = validateRelayToken(secret, token);
      expect(result).toBeUndefined();
    });

    it("rejects tampered payload", () => {
      const token = createRelayToken(secret, { peer: "alice", srv: "s1" });
      const [payloadB64, hmacB64] = token.split(".");
      // Tamper with payload
      const tampered = Buffer.from(JSON.stringify({ peer: "eve", nonce: "0".repeat(32), exp: 9999999999, srv: "s1" })).toString("base64url");
      const result = validateRelayToken(secret, `${tampered}.${hmacB64}`);
      expect(result).toBeUndefined();
    });

    it("rejects tampered HMAC", () => {
      const token = createRelayToken(secret, { peer: "alice", srv: "s1" });
      const payloadB64 = token.split(".")[0]!;
      const fakeHmac = randomBytes(32).toString("base64url");
      const result = validateRelayToken(secret, `${payloadB64}.${fakeHmac}`);
      expect(result).toBeUndefined();
    });

    it("rejects wrong secret", () => {
      const token = createRelayToken(secret, { peer: "alice", srv: "s1" });
      const wrongSecret = randomBytes(32);
      const result = validateRelayToken(wrongSecret, token);
      expect(result).toBeUndefined();
    });

    it("rejects token without dot separator", () => {
      const result = validateRelayToken(secret, "nodot");
      expect(result).toBeUndefined();
    });

    it("rejects token with truncated HMAC", () => {
      const token = createRelayToken(secret, { peer: "alice", srv: "s1" });
      const payloadB64 = token.split(".")[0]!;
      const result = validateRelayToken(secret, `${payloadB64}.short`);
      expect(result).toBeUndefined();
    });
  });
});
