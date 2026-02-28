import { TOTP, Secret } from "otpauth";

/**
 * Verify a TOTP code against a base32 secret.
 * Accepts current step and ±1 step (±30 seconds tolerance).
 */
export function verifyTotpCode(secret: string, code: string): boolean {
  if (!code || !secret) return false;

  const totp = new TOTP({
    issuer: "mecha",
    label: "dashboard",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });

  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}

/** Returns process.env.MECHA_OTP or null. */
export function getOtpSecret(): string | null {
  return process.env.MECHA_OTP ?? null;
}
