import { TOTP, Secret } from "otpauth";

/** Returns true when MECHA_AUTH_BYPASS=true — skips TOTP code validation. */
export function isAuthBypassed(): boolean {
  return process.env.MECHA_AUTH_BYPASS === "true";
}

/**
 * Verify a TOTP code against a base32 secret.
 * When MECHA_AUTH_BYPASS=true, accepts any code (for integration testing).
 */
export function verifyTotpCode(secret: string, code: string): boolean {
  if (isAuthBypassed()) return true;
  if (!code || !secret) return false;

  const totp = new TOTP({
    issuer: "mecha",
    label: "dashboard",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });

  const delta = totp.validate({ token: code, window: 0 });
  return delta !== null;
}

/** Returns process.env.MECHA_OTP or null. */
export function getOtpSecret(): string | null {
  return process.env.MECHA_OTP ?? null;
}
