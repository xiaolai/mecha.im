import type { FastifyRequest, FastifyReply } from "fastify";
import { safeCompare } from "@mecha/core";
import type { verifySignature as VerifySignatureFn } from "@mecha/core";

export interface AuthOpts {
  apiKey: string;
  /**
   * Optional: map of node name → public key PEM.
   * When provided, routing requests must include a valid X-Mecha-Signature.
   */
  nodePublicKeys?: Map<string, string>;
  /** Signature verification function — defaults to @mecha/core verifySignature */
  verifySignature?: typeof VerifySignatureFn;
}

/**
 * Fastify onRequest hook that validates Bearer token.
 */
export function createAuthHook(opts: AuthOpts) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Healthz is public (match pathname only, ignore query string)
    const pathname = request.url.split("?")[0];
    if (pathname === "/healthz") return;

    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ") || !safeCompare(auth.slice(7), opts.apiKey)) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
  };
}

/**
 * Fastify preHandler hook that verifies Ed25519 signatures on routing endpoints.
 * Must run after body parsing (preHandler), not onRequest.
 */
export function createSignatureHook(opts: AuthOpts) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    /* v8 ignore start -- signature verification tested in mesh E2E integration tests */
    if (!opts.nodePublicKeys || !opts.verifySignature) return;

    const pathname = request.url.split("?")[0];
    // Only verify signatures on POST /casas/:name/query routing endpoints
    if (!pathname?.startsWith("/casas/") || !pathname.endsWith("/query") || request.method !== "POST") return;

    const source = getSource(request);
    const sigHeader = request.headers["x-mecha-signature"];

    if (!source || typeof sigHeader !== "string") {
      reply.code(401).send({ error: "Missing signature or source header" });
      return;
    }

    // Extract node name from source (e.g. "coder@alice" → "alice")
    const nodeName = source.includes("@") ? source.split("@")[1]! : undefined;
    if (!nodeName) {
      reply.code(401).send({ error: "Source must include node name (casa@node)" });
      return;
    }

    const publicKeyPem = opts.nodePublicKeys.get(nodeName);
    if (!publicKeyPem) {
      reply.code(401).send({ error: `Unknown node: ${nodeName}` });
      return;
    }

    // Verify base64 signature against request body
    // TODO(Phase 6): Sign canonical envelope (method+path+source+timestamp+body) to prevent replay
    try {
      const bodyStr = JSON.stringify((request as FastifyRequest & { body: unknown }).body ?? "");
      const valid = opts.verifySignature(publicKeyPem, new TextEncoder().encode(bodyStr), sigHeader);
      if (!valid) {
        reply.code(401).send({ error: "Invalid signature" });
        return;
      }
    } catch {
      reply.code(401).send({ error: "Malformed signature" });
      return;
    }
    /* v8 ignore stop */
  };
}

/** Extract X-Mecha-Source header from request */
export function getSource(request: FastifyRequest): string | undefined {
  const header = request.headers["x-mecha-source"];
  return typeof header === "string" ? header : undefined;
}
