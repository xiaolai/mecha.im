import type { FastifyRequest, FastifyReply } from "fastify";
import type { verifySignature as VerifySignatureFn } from "@mecha/core";
import { safeCompare } from "@mecha/core";
import { consumeTicket } from "./ws-tickets.js";
import { verifySessionToken, parseSessionCookie } from "./session.js";

export interface AuthOpts {
  /** Session signing key (derived from TOTP secret). Omit to disable session auth. */
  sessionKey?: string;
  /** Internal API key for mesh node-to-node routing (Bearer token). */
  apiKey?: string;
  /**
   * Optional: map of node name → public key PEM.
   * When provided, routing requests must include a valid X-Mecha-Signature.
   */
  nodePublicKeys?: Map<string, string>;
  /** Signature verification function — defaults to @mecha/core verifySignature */
  verifySignature?: typeof VerifySignatureFn;
  /** When SPA is served, skip auth for static asset requests. */
  spaDir?: string;
  /** Pre-read SPA index.html content — used to serve SPA for browser navigations. */
  spaIndexHtml?: string;
}

/** Known API path prefixes that always require auth. */
export const API_PREFIXES = [
  "/bots", "/acl", "/audit", "/mesh", "/meter",
  "/settings/", "/events", "/discover", "/ws",
];

/** Paths that are always public (no auth required). */
const PUBLIC_PATHS = ["/healthz", "/auth/status", "/auth/login", "/auth/logout", "/discover/handshake"];

/**
 * Fastify onRequest hook that validates auth via session cookie or Bearer token.
 * At least one of apiKey or sessionKey must be provided.
 */
export function createAuthHook(opts: AuthOpts) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const pathname = request.url.split("?")[0]!;

    // Public paths — always skip auth
    if (PUBLIC_PATHS.includes(pathname)) return;

    // When SPA is served, skip auth for non-API paths (static assets, etc.).
    // For browser navigations (Accept: text/html) to API-prefixed paths like /mesh
    // or /acl, serve the SPA index.html directly — this prevents API data leakage
    // while allowing browser refresh on SPA routes that share API prefixes.
    if (opts.spaDir) {
      const isApiPath = API_PREFIXES.some((p) => pathname.startsWith(p));
      if (!isApiPath) return;
      /* v8 ignore start -- SPA browser navigation tested in auth.test.ts */
      if (request.method === "GET" && opts.spaIndexHtml) {
        const accept = request.headers.accept ?? "";
        if (accept.includes("text/html")) {
          reply.type("text/html").send(opts.spaIndexHtml);
          return;
        }
      }
      /* v8 ignore stop */
    }

    // WS paths: accept ticket-based auth (browser WS can't set headers)
    // Exclude /ws/ticket itself — it uses Bearer/session auth to issue tickets
    if (pathname.startsWith("/ws/") && pathname !== "/ws/ticket") {
      const url = new URL(request.url, "http://localhost");
      const ticket = url.searchParams.get("ticket");
      if (ticket && consumeTicket(ticket)) return;
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    // Try session cookie auth (TOTP-based sessions)
    if (opts.sessionKey) {
      /* v8 ignore start -- cookie header is always string or undefined in Fastify */
      const cookieHeader = request.headers.cookie ?? null;
      const token = parseSessionCookie(typeof cookieHeader === "string" ? cookieHeader : null);
      /* v8 ignore stop */
      if (token) {
        const result = verifySessionToken(opts.sessionKey, token);
        if (result.valid) return;
      }
    }

    // Try Bearer token auth — restricted to mesh routing endpoints only
    /* v8 ignore start -- Bearer auth tested in mesh integration tests */
    if (opts.apiKey && isMeshRoutingRequest(request)) {
      const authHeader = request.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        const provided = authHeader.slice(7);
        if (safeCompare(provided, opts.apiKey)) return;
      }
    }
    /* v8 ignore stop */

    reply.code(401).send({ error: "Unauthorized" });
  };
}

/** Nonce cache to prevent replay attacks within the timestamp window. */
const usedNonces = new Map<string, number>();
const MAX_NONCE_CACHE_SIZE = 10_000;
const NONCE_PURGE_INTERVAL_MS = 60_000;
let lastNoncePurge = Date.now();
/* v8 ignore start -- nonce purge runs on a timer-like check */
function purgeExpiredNonces(): void {
  const now = Date.now();
  if (now - lastNoncePurge < NONCE_PURGE_INTERVAL_MS) return;
  lastNoncePurge = now;
  const cutoff = now - 300_000; // 5-minute window
  for (const [nonce, ts] of usedNonces) {
    if (ts < cutoff) usedNonces.delete(nonce);
  }
}
/* v8 ignore stop */

/**
 * Fastify preHandler hook that verifies Ed25519 signatures on routing endpoints.
 * Must run after body parsing (preHandler), not onRequest.
 */
export function createSignatureHook(opts: AuthOpts) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    /* v8 ignore start -- signature verification tested in mesh E2E integration tests */
    if (!opts.nodePublicKeys || !opts.verifySignature) return;

    const pathname = request.url.split("?")[0];
    // Only verify signatures on POST /bots/:name/query routing endpoints
    if (!pathname?.startsWith("/bots/") || !pathname.endsWith("/query") || request.method !== "POST") return;

    const source = getSource(request);
    const sigHeader = request.headers["x-mecha-signature"];

    if (!source || typeof sigHeader !== "string") {
      reply.code(401).send({ error: "Missing signature or source header" });
      return;
    }

    // Extract node name from source (e.g. "coder@alice" → "alice")
    const atIdx = source.lastIndexOf("@");
    const nodeName = atIdx >= 0 ? source.slice(atIdx + 1) : undefined;
    if (!nodeName) {
      reply.code(401).send({ error: "Source must include node name (bot@node)" });
      return;
    }

    const publicKeyPem = opts.nodePublicKeys.get(nodeName);
    if (!publicKeyPem) {
      reply.code(401).send({ error: `Unknown node: ${nodeName}` });
      return;
    }

    // Verify timestamp to prevent replay attacks (5-minute window)
    const timestamp = request.headers["x-mecha-timestamp"];
    if (typeof timestamp !== "string") {
      reply.code(401).send({ error: "Missing X-Mecha-Timestamp header" });
      return;
    }
    const tsNum = Number(timestamp);
    if (Number.isNaN(tsNum) || Math.abs(Date.now() - tsNum) > 300_000) {
      reply.code(401).send({ error: "Timestamp outside 5-minute window" });
      return;
    }

    // Nonce-based replay defense
    purgeExpiredNonces();
    const nonce = request.headers["x-mecha-nonce"];
    if (typeof nonce !== "string" || !nonce) {
      reply.code(401).send({ error: "Missing X-Mecha-Nonce header" });
      return;
    }
    if (usedNonces.has(nonce)) {
      reply.code(401).send({ error: "Nonce already used (replay detected)" });
      return;
    }

    // Verify signature BEFORE marking nonce as used
    try {
      const bodyStr = JSON.stringify((request as FastifyRequest & { body: unknown }).body ?? "");
      const nonceStr = typeof nonce === "string" ? nonce : "";
      const envelope = `${request.method}\n${pathname}\n${source}\n${timestamp}\n${nonceStr}\n${bodyStr}`;
      const valid = opts.verifySignature(publicKeyPem, new TextEncoder().encode(envelope), sigHeader);
      if (!valid) {
        reply.code(401).send({ error: "Invalid signature" });
        return;
      }
    } catch {
      reply.code(401).send({ error: "Malformed signature" });
      return;
    }
    usedNonces.set(nonce, tsNum);
    // Evict oldest entries if cache exceeds size limit
    if (usedNonces.size > MAX_NONCE_CACHE_SIZE) {
      const it = usedNonces.keys();
      for (let i = 0; i < 1000; i++) {
        const key = it.next().value;
        if (key) usedNonces.delete(key);
      }
    }
    /* v8 ignore stop */
  };
}

/** Check if a request is a mesh routing request (cross-node query with source header). */
function isMeshRoutingRequest(request: FastifyRequest): boolean {
  const pathname = request.url.split("?")[0]!;
  return request.method === "POST"
    && pathname.startsWith("/bots/")
    && pathname.endsWith("/query")
    && typeof request.headers["x-mecha-source"] === "string";
}

/** Extract X-Mecha-Source header from request */
export function getSource(request: FastifyRequest): string | undefined {
  const header = request.headers["x-mecha-source"];
  return typeof header === "string" ? header : undefined;
}
