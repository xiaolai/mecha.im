/**
 * Session key derivation and token creation for TOTP-based auth.
 *
 * The session key is derived from the TOTP secret via HMAC-SHA256.
 * Session tokens are HMAC-SHA256 of a counter value, hex-encoded.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_DERIVE_LABEL = "mecha-session-key";

/** Derive a session key from a TOTP secret string. */
export function deriveSessionKey(totpSecret: string): Uint8Array {
  const hmac = createHmac("sha256", totpSecret);
  hmac.update(SESSION_DERIVE_LABEL);
  return new Uint8Array(hmac.digest());
}

/** Create a session token for the given counter value. */
export function createSessionToken(sessionKey: Uint8Array, counter: number): string {
  const hmac = createHmac("sha256", Buffer.from(sessionKey));
  hmac.update(String(counter));
  return hmac.digest("hex");
}

/**
 * Validate a session token against a TOTP secret.
 * Checks a sliding window of counter values (current ± 2) to
 * tolerate minor clock drift.
 */
export function validateSessionToken(totpSecret: string, token: string): boolean {
  const sessionKey = deriveSessionKey(totpSecret);
  for (let counter = 0; counter <= 4; counter++) {
    const expected = createSessionToken(sessionKey, counter);
    if (timingSafeCompareHex(expected, token)) return true;
  }
  return false;
}

/** Timing-safe hex string comparison. */
function timingSafeCompareHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
