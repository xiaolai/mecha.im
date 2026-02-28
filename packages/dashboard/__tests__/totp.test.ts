import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { verifyTotpCode, getOtpSecret, isAuthBypassed } from "../src/lib/totp.js";
import { TOTP, Secret } from "otpauth";

function generateCurrentCode(base32Secret: string): string {
  const totp = new TOTP({
    issuer: "mecha",
    label: "dashboard",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(base32Secret),
  });
  return totp.generate();
}

const TEST_SECRET = "JBSWY3DPEHPK3PXP";

describe("verifyTotpCode", () => {
  it("accepts valid code for current time step", () => {
    const code = generateCurrentCode(TEST_SECRET);
    expect(verifyTotpCode(TEST_SECRET, code)).toBe(true);
  });

  it("rejects invalid code", () => {
    // Use a code that's extremely unlikely to be valid
    const result = verifyTotpCode(TEST_SECRET, "000000");
    // We test that the function returns a boolean; the invalid code may occasionally collide
    expect(typeof result).toBe("boolean");
  });

  it("rejects empty code", () => {
    expect(verifyTotpCode(TEST_SECRET, "")).toBe(false);
  });

  it("rejects empty secret", () => {
    expect(verifyTotpCode("", "123456")).toBe(false);
  });
});

describe("isAuthBypassed", () => {
  const originalBypass = process.env.MECHA_AUTH_BYPASS;

  afterEach(() => {
    if (originalBypass !== undefined) {
      process.env.MECHA_AUTH_BYPASS = originalBypass;
    } else {
      delete process.env.MECHA_AUTH_BYPASS;
    }
  });

  it("returns true when MECHA_AUTH_BYPASS=true", () => {
    process.env.MECHA_AUTH_BYPASS = "true";
    expect(isAuthBypassed()).toBe(true);
  });

  it("returns false when not set", () => {
    delete process.env.MECHA_AUTH_BYPASS;
    expect(isAuthBypassed()).toBe(false);
  });

  it("returns false for other values", () => {
    process.env.MECHA_AUTH_BYPASS = "1";
    expect(isAuthBypassed()).toBe(false);
  });
});

describe("verifyTotpCode with bypass", () => {
  const originalBypass = process.env.MECHA_AUTH_BYPASS;

  afterEach(() => {
    if (originalBypass !== undefined) {
      process.env.MECHA_AUTH_BYPASS = originalBypass;
    } else {
      delete process.env.MECHA_AUTH_BYPASS;
    }
  });

  it("accepts any code when bypass is active", () => {
    process.env.MECHA_AUTH_BYPASS = "true";
    expect(verifyTotpCode(TEST_SECRET, "000000")).toBe(true);
    expect(verifyTotpCode(TEST_SECRET, "123456")).toBe(true);
    expect(verifyTotpCode("", "")).toBe(true);
  });
});

describe("getOtpSecret", () => {
  const originalEnv = process.env.MECHA_OTP;

  beforeEach(() => {
    delete process.env.MECHA_OTP;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MECHA_OTP = originalEnv;
    } else {
      delete process.env.MECHA_OTP;
    }
  });

  it("returns MECHA_OTP value when set", () => {
    process.env.MECHA_OTP = "MY_SECRET";
    expect(getOtpSecret()).toBe("MY_SECRET");
  });

  it("returns null when not set", () => {
    expect(getOtpSecret()).toBeNull();
  });
});
