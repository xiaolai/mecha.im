import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 * Used for bearer token validation across all servers.
 */
export function safeCompare(a: string, b: string): boolean {
  // Reject oversized tokens to prevent memory-amplification DoS
  const MAX_TOKEN_LEN = 4096;
  if (a.length > MAX_TOKEN_LEN || b.length > MAX_TOKEN_LEN) return false;
  // Use byte buffers to correctly handle multibyte UTF-8 characters
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  const maxLen = Math.max(aBuf.length, bBuf.length);
  // Pad both to same byte length to prevent length-based timing leaks
  const aPadded = Buffer.alloc(maxLen);
  const bPadded = Buffer.alloc(maxLen);
  aBuf.copy(aPadded);
  bBuf.copy(bPadded);
  // Always run timingSafeEqual first, then combine with length check
  // to avoid short-circuit timing leakage on length mismatch
  const contentsEqual = timingSafeEqual(aPadded, bPadded);
  const lengthsEqual = aBuf.length === bBuf.length;
  return contentsEqual && lengthsEqual;
}
