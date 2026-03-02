import { describe, it, expect } from "vitest";
import { TOTP, Secret } from "otpauth";
import { verifyTotpCode } from "../src/totp.js";

function generateCode(secret: string): string {
  const totp = new TOTP({
    issuer: "mecha",
    label: "agent",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
  return totp.generate();
}

describe("verifyTotpCode", () => {
  const secret = new Secret({ size: 20 }).base32;

  it("accepts valid code", () => {
    const code = generateCode(secret);
    expect(verifyTotpCode(secret, code)).toBe(true);
  });

  it("rejects invalid code", () => {
    expect(verifyTotpCode(secret, "000000")).toBe(false);
  });

  it("rejects empty code", () => {
    expect(verifyTotpCode(secret, "")).toBe(false);
  });

  it("rejects empty secret", () => {
    expect(verifyTotpCode("", "123456")).toBe(false);
  });
});
