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
  return a.length === b.length && timingSafeEqual(aPadded, bPadded);
}
