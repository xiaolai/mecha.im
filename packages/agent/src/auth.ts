/**
 * Authentication hooks for the agent Fastify server.
 *
 * Supports:
 * - TOTP session cookie (mecha-session=<token>)
 * - Ed25519 request signatures (x-mecha-signature header)
 * - Nonce replay protection
 * - Timestamp window enforcement (5 min)
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { readNodes, verifySignature } from "@mecha/core";
import { validateSessionToken } from "./session.js";

const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_NONCES = 10_000;

/** Bounded set for nonce deduplication. Evicts oldest entries when full. */
class NonceSet {
  private set = new Set<string>();
  private queue: string[] = [];
  private max: number;

  constructor(max: number) {
    this.max = max;
  }

  has(nonce: string): boolean {
    return this.set.has(nonce);
  }

  add(nonce: string): void {
    if (this.set.has(nonce)) return;
    if (this.queue.length >= this.max) {
      const oldest = this.queue.shift()!;
      this.set.delete(oldest);
    }
    this.set.add(nonce);
    this.queue.push(nonce);
  }
}

export interface AuthConfig {
  totpSecret?: string;
  apiKey?: string;
}

export interface AuthContext {
  config: AuthConfig;
  mechaDir: string;
  nonces: NonceSet;
}

export function createAuthContext(config: AuthConfig, mechaDir: string): AuthContext {
  return { config, mechaDir, nonces: new NonceSet(MAX_NONCES) };
}

/** Parse mecha-session token from cookie header. */
function parseSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith("mecha-session=")) {
      return trimmed.slice("mecha-session=".length);
    }
  }
  return undefined;
}

/**
 * Fastify preHandler hook for authentication.
 * Skips /healthz. Accepts either:
 * - Bearer token (Authorization: Bearer <apiKey>) for mesh routing
 * - Session cookie (mecha-session=<token>) for dashboard/CLI
 */
export function createAuthHook(authCtx: AuthContext) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Skip auth for health check
    if (req.url === "/healthz") return;

    const { config } = authCtx;

    // No auth configured — allow all
    if (!config.totpSecret && !config.apiKey) return;

    // Try Bearer token auth first (mesh routing)
    const authHeader = req.headers.authorization ?? "";
    if (authHeader.toLowerCase().startsWith("bearer ")) {
      const bearer = authHeader.slice(7);
      if (config.apiKey && timingSafeCompareStr(bearer, config.apiKey)) {
        return; // Bearer auth succeeded
      }
      // Invalid bearer — fall through to try session cookie
    }

    // Try session cookie auth (dashboard/CLI)
    if (config.totpSecret) {
      const cookieHeader = req.headers.cookie;
      const token = parseSessionCookie(cookieHeader);
      if (token && validateSessionToken(config.totpSecret, token)) {
        return; // Session cookie auth succeeded
      }
    }

    reply.status(401).send({ error: "Unauthorized" });
  };
}

/** Timing-safe string comparison. */
function timingSafeCompareStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA); // constant-time even on length mismatch
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify Ed25519 request signature if signature headers are present.
 * Returns null if valid or no signature headers. Returns error string if invalid.
 */
export function verifyRequestSignature(
  req: FastifyRequest,
  rawBody: string,
  authCtx: AuthContext,
): string | null {
  const timestamp = req.headers["x-mecha-timestamp"] as string | undefined;
  const nonce = req.headers["x-mecha-nonce"] as string | undefined;
  const signature = req.headers["x-mecha-signature"] as string | undefined;

  // No signature headers — skip verification
  if (!timestamp && !nonce && !signature) return null;

  // If any signature header is present, all must be present
  if (!timestamp || !nonce || !signature) {
    return "Incomplete signature headers";
  }

  // Timestamp window check
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_WINDOW_MS) {
    return "Timestamp expired or invalid";
  }

  // Nonce replay check
  if (authCtx.nonces.has(nonce)) {
    return "Nonce already used";
  }

  // Find sender's public key
  const source = (req.headers["x-mecha-source"] as string) ?? "admin";
  const atIdx = source.indexOf("@");
  const nodeName = atIdx >= 0 ? source.slice(atIdx + 1) : undefined;

  if (!nodeName) {
    return "Cannot verify signature: no node in source";
  }

  const nodes = readNodes(authCtx.mechaDir);
  const senderNode = nodes.find((n) => n.name === nodeName);
  if (!senderNode?.publicKey) {
    return "Cannot verify signature: unknown node or missing public key";
  }

  // Construct canonical envelope
  const method = req.method;
  const path = req.url.split("?")[0];
  const envelope = `${method}\n${path}\n${source}\n${timestamp}\n${nonce}\n${rawBody}`;

  // Verify Ed25519 signature
  const valid = verifySignature(senderNode.publicKey, new Uint8Array(Buffer.from(envelope)), signature);
  if (!valid) {
    return "Invalid signature";
  }

  // Mark nonce as used
  authCtx.nonces.add(nonce);
  return null;
}
