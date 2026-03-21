import { describe, it, expect } from "vitest";
import { generateKeyPair, fingerprint } from "../../src/identity/keys.js";

describe("generateKeyPair", () => {
  it("returns PEM-encoded public and private keys", () => {
    const kp = generateKeyPair();
    expect(kp.publicKey).toContain("BEGIN PUBLIC KEY");
    expect(kp.privateKey).toContain("BEGIN PRIVATE KEY");
  });

  it("generates unique keypairs on each call", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
  });
});

describe("fingerprint", () => {
  it("returns a 16-character hex string", () => {
    const kp = generateKeyPair();
    const fp = fingerprint(kp.publicKey);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic for the same key", () => {
    const kp = generateKeyPair();
    expect(fingerprint(kp.publicKey)).toBe(fingerprint(kp.publicKey));
  });

  it("differs for different keys", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    expect(fingerprint(a.publicKey)).not.toBe(fingerprint(b.publicKey));
  });
});
