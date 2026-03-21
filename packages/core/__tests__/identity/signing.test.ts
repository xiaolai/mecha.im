import { describe, it, expect } from "vitest";
import { generateKeyPair } from "../../src/identity/keys.js";
import { signMessage, verifySignature } from "../../src/identity/signing.js";

describe("signMessage / verifySignature", () => {
  it("round-trips: sign then verify succeeds", () => {
    const kp = generateKeyPair();
    const data = new TextEncoder().encode("hello world");
    const sig = signMessage(kp.privateKey, data);
    expect(verifySignature(kp.publicKey, data, sig)).toBe(true);
  });

  it("detects tampered data", () => {
    const kp = generateKeyPair();
    const data = new TextEncoder().encode("original");
    const sig = signMessage(kp.privateKey, data);
    const tampered = new TextEncoder().encode("tampered");
    expect(verifySignature(kp.publicKey, tampered, sig)).toBe(false);
  });

  it("detects wrong key", () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const data = new TextEncoder().encode("test");
    const sig = signMessage(kp1.privateKey, data);
    expect(verifySignature(kp2.publicKey, data, sig)).toBe(false);
  });

  it("returns a base64 string", () => {
    const kp = generateKeyPair();
    const data = new TextEncoder().encode("test");
    const sig = signMessage(kp.privateKey, data);
    // Valid base64
    expect(Buffer.from(sig, "base64").toString("base64")).toBe(sig);
  });
});
