import { createHmac } from "node:crypto";

const STEP = 30; // seconds
const DIGITS = 6;
const WINDOW = 1; // ±1 step to handle clock skew

/** Decode a base32-encoded string to a Buffer */
function decodeBase32(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
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

/** Generate a TOTP code for a given time step */
function generateCode(secret: Buffer, counter: bigint): string {
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

/** Verify a 6-digit TOTP code against a base32 secret. Allows ±1 time step window. */
export function verifyTotp(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;

  let key: Buffer;
  try {
    key = decodeBase32(secret);
  } catch {
    return false;
  }

  const now = BigInt(Math.floor(Date.now() / 1000 / STEP));

  for (let i = -WINDOW; i <= WINDOW; i++) {
    if (generateCode(key, now + BigInt(i)) === code) return true;
  }

  return false;
}

/** Generate the current TOTP code for a base32 secret (useful for testing). */
export function generateTotp(secret: string): string {
  const key = decodeBase32(secret);
  const counter = BigInt(Math.floor(Date.now() / 1000 / STEP));
  return generateCode(key, counter);
}
