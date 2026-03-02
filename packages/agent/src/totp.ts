import { TOTP, Secret } from "otpauth";

/**
 * Verify a TOTP code against a base32 secret.
 * window: 1 allows ±30s clock skew (standard TOTP recommendation).
 */
export function verifyTotpCode(secret: string, code: string): boolean {
  if (!code || !secret) return false;

  try {
    const totp = new TOTP({
      issuer: "mecha",
      label: "agent",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    });

    const delta = totp.validate({ token: code, window: 1 });
    return delta !== null;
  /* v8 ignore start -- malformed secret fallback */
  } catch {
    return false;
  }
  /* v8 ignore stop */
}
