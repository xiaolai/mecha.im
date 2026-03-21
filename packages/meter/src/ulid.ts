import { randomBytes } from "node:crypto";

const CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(now: number, len: number): string {
  let ts = now;
  const out = new Array<string>(len);
  for (let i = len - 1; i >= 0; i--) {
    out[i] = CHARS[ts % 32]!;
    ts = Math.floor(ts / 32);
  }
  return out.join("");
}

function encodeRandom(len: number): string {
  const bytes = randomBytes(len);
  const out = new Array<string>(len);
  for (let i = 0; i < len; i++) {
    out[i] = CHARS[bytes[i]! % 32]!;
  }
  return out.join("");
}

/** Generate a ULID (Universally Unique Lexicographically Sortable Identifier) */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now, 10) + encodeRandom(16);
}
