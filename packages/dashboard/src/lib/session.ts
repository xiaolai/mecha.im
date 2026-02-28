import { hkdfSync, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "mecha-session";

const HKDF_SALT = "mecha-dashboard-session";
const HKDF_INFO = "jwt-signing";
const KEY_LENGTH = 32;

/** Derive a hex signing key from the OTP secret via HKDF-SHA256. */
export function deriveSessionKey(otpSecret: string): string {
  const key = hkdfSync("sha256", otpSecret, HKDF_SALT, HKDF_INFO, KEY_LENGTH);
  return Buffer.from(key).toString("hex");
}

function base64url(data: string | Buffer): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf.toString("base64url");
}

function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

/** Create a signed JWT (HS256) with iat and exp. */
export function createSessionToken(key: string, ttlHours: number = 24): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({ iat: now, exp: now + ttlHours * 3600 }));
  const sigInput = `${header}.${payload}`;
  const sig = base64url(createHmac("sha256", Buffer.from(key, "hex")).update(sigInput).digest());
  return `${sigInput}.${sig}`;
}

/** Verify a JWT signature and expiry. */
export function verifySessionToken(
  key: string,
  token: string,
): { valid: true; iat: number; exp: number } | { valid: false } {
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false };

  const header = parts[0]!;
  const payload = parts[1]!;
  const sig = parts[2]!;
  const sigInput = `${header}.${payload}`;
  const expectedSig = createHmac("sha256", Buffer.from(key, "hex")).update(sigInput).digest();
  const actualSig = base64urlDecode(sig);

  if (expectedSig.length !== actualSig.length) return { valid: false };
  if (!timingSafeEqual(expectedSig, actualSig)) return { valid: false };

  try {
    const data = JSON.parse(base64urlDecode(payload).toString()) as { iat: number; exp: number };
    const now = Math.floor(Date.now() / 1000);
    if (data.exp <= now) return { valid: false };
    return { valid: true, iat: data.iat, exp: data.exp };
  } catch {
    return { valid: false };
  }
}

/** Extract mecha-session value from a Cookie header string. */
export function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.trim().split("=");
    if (name === SESSION_COOKIE) {
      return rest.join("=") || null;
    }
  }
  return null;
}
