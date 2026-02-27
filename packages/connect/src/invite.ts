import { randomBytes } from "node:crypto";
import { DEFAULTS, InvalidInviteError, signMessage, verifySignature } from "@mecha/core";
import type { NodeIdentity } from "@mecha/core";
import type { RendezvousClient, InviteOpts, InviteCode, InvitePayload } from "./types.js";

const INVITE_SCHEME = "mecha://invite/";

/** Encode payload as base64url. */
function encodePayload(payload: InvitePayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json).toString("base64url");
}

/** Decode base64url payload. */
function decodePayload(encoded: string): unknown {
  const json = Buffer.from(encoded, "base64url").toString("utf-8");
  return JSON.parse(json);
}

/** Sign the invite payload (excluding the signature field itself).
 * NOTE: relies on JSON.stringify key order matching between sign and verify.
 * Both paths use JS object literal order (deterministic in V8/Node.js). */
function signInvite(payload: Omit<InvitePayload, "signature">, privateKey: string): string {
  const data = JSON.stringify(payload);
  // signMessage(privateKeyPem, data) returns base64 string
  return signMessage(privateKey, new TextEncoder().encode(data));
}

/** Verify the invite signature against the inviter's public key. */
function verifyInviteSignature(payload: InvitePayload): boolean {
  const { signature, ...rest } = payload;
  const data = JSON.stringify(rest);
  try {
    // verifySignature(publicKeyPem, data, signatureBase64)
    return verifySignature(
      payload.inviterPublicKey,
      new TextEncoder().encode(data),
      signature,
    );
  /* v8 ignore start -- crypto verify throws on corrupt key material */
  } catch {
    return false;
  }
  /* v8 ignore stop */
}

export interface CreateInviteOpts {
  /** Rendezvous client — optional for offline invite creation. */
  client?: RendezvousClient;
  identity: NodeIdentity;
  nodeName: string;
  noisePublicKey: string;
  privateKey: string;
  rendezvousUrl?: string;
  opts?: InviteOpts;
}

/** Create a signed invite code. The rendezvous client is reserved for future server-side registration. */
export async function createInviteCode(createOpts: CreateInviteOpts): Promise<InviteCode> {
  const {
    identity,
    nodeName,
    noisePublicKey,
    privateKey,
    rendezvousUrl = DEFAULTS.RENDEZVOUS_URL,
    opts,
  } = createOpts;

  const expiresIn = opts?.expiresIn ?? DEFAULTS.INVITE_EXPIRY_S;
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  const payloadWithoutSig = {
    inviterName: nodeName,
    inviterPublicKey: identity.publicKey,
    inviterFingerprint: identity.fingerprint,
    inviterNoisePublicKey: noisePublicKey,
    rendezvousUrl,
    token,
    expiresAt,
  };

  const signature = signInvite(payloadWithoutSig, privateKey);
  const payload: InvitePayload = { ...payloadWithoutSig, signature };
  const code = INVITE_SCHEME + encodePayload(payload);

  return { code, token, expiresAt };
}

/** Parse and validate an invite code string. Throws InvalidInviteError on failure. */
export function parseInviteCode(code: string): InvitePayload {
  if (!code.startsWith(INVITE_SCHEME)) {
    throw new InvalidInviteError("Expected mecha:// scheme");
  }

  const encoded = code.slice(INVITE_SCHEME.length);
  if (!encoded) {
    throw new InvalidInviteError("Malformed invite code");
  }

  let raw: unknown;
  try {
    raw = decodePayload(encoded);
  } catch {
    throw new InvalidInviteError("Malformed invite code");
  }

  if (!isInvitePayload(raw)) {
    throw new InvalidInviteError("Malformed invite code");
  }

  // Validate field formats beyond type checks
  if (!/^wss?:\/\//i.test(raw.rendezvousUrl)) {
    throw new InvalidInviteError("Invalid rendezvous URL scheme (expected ws:// or wss://)");
  }
  if (!/^[0-9a-f]{16}$/.test(raw.inviterFingerprint)) {
    throw new InvalidInviteError("Invalid fingerprint format");
  }

  // Check expiry client-side
  const expiryTs = new Date(raw.expiresAt).getTime();
  if (!Number.isFinite(expiryTs) || expiryTs < Date.now()) {
    throw new InvalidInviteError("Invite expired");
  }

  // Verify signature
  if (!verifyInviteSignature(raw)) {
    throw new InvalidInviteError("Invalid invite signature");
  }

  return raw;
}

function isInvitePayload(v: unknown): v is InvitePayload {
  /* v8 ignore start -- null from JSON.parse is caught by typeof check */
  if (typeof v !== "object" || v === null) return false;
  /* v8 ignore stop */
  const o = v as Record<string, unknown>;
  return (
    typeof o.inviterName === "string" &&
    typeof o.inviterPublicKey === "string" &&
    typeof o.inviterFingerprint === "string" &&
    typeof o.inviterNoisePublicKey === "string" &&
    typeof o.rendezvousUrl === "string" &&
    typeof o.token === "string" &&
    typeof o.expiresAt === "string" &&
    typeof o.signature === "string"
  );
}
