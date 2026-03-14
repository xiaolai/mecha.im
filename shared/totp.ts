import { createHmac, randomBytes } from "node:crypto";

// RFC 6238 TOTP — HMAC-SHA1, 6 digits, 30-second step

const DIGITS = 6;
const STEP = 30;
const WINDOW = 1; // ±1 window tolerance

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateSecret(): string {
  const bytes = randomBytes(20);
  return base32Encode(bytes);
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    out += BASE32[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

export function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: bigint): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(counter);
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function generateTOTP(secretBase32: string, time?: number): string {
  const secret = base32Decode(secretBase32);
  const counter = BigInt(Math.floor((time ?? Date.now() / 1000) / STEP));
  return hotp(secret, counter);
}

export function verifyTOTP(secretBase32: string, code: string, time?: number): boolean {
  const secret = base32Decode(secretBase32);
  const now = time ?? Date.now() / 1000;
  const counter = Math.floor(now / STEP);
  for (let i = -WINDOW; i <= WINDOW; i++) {
    if (hotp(secret, BigInt(counter + i)) === code) return true;
  }
  return false;
}

export function totpUri(secret: string, issuer: string, account: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;
}
