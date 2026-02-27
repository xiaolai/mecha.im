import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 * Used for bearer token validation across all servers.
 */
export function safeCompare(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  // Pad both to same length to prevent length-based timing leaks
  const aPadded = Buffer.alloc(maxLen);
  const bPadded = Buffer.alloc(maxLen);
  Buffer.from(a).copy(aPadded);
  Buffer.from(b).copy(bPadded);
  // Always run timingSafeEqual first, then combine with length check
  // to avoid short-circuit timing leakage on length mismatch
  const contentsEqual = timingSafeEqual(aPadded, bPadded);
  const lengthsEqual = a.length === b.length;
  return contentsEqual && lengthsEqual;
}
