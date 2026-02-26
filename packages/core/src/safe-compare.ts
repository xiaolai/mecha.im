import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 * Used for bearer token validation across all servers.
 */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
