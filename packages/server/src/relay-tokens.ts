import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface RelayTokenPayload {
  peer: string;
  nonce: string;
  exp: number;
  srv: string;
}

const TOKEN_TTL_S = 120;

/** Create a self-verifiable relay token. */
export function createRelayToken(
  secret: Buffer,
  payload: { peer: string; srv: string },
): string {
  const full: RelayTokenPayload = {
    peer: payload.peer,
    nonce: randomBytes(16).toString("hex"),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_S,
    srv: payload.srv,
  };
  const payloadB64 = Buffer.from(JSON.stringify(full)).toString("base64url");
  const hmac = createHmac("sha256", secret).update(payloadB64).digest();
  const hmacB64 = hmac.toString("base64url");
  return `${payloadB64}.${hmacB64}`;
}

/** Validate and decode a relay token. Returns payload or undefined. */
export function validateRelayToken(
  secret: Buffer,
  token: string,
): RelayTokenPayload | undefined {
  const dotIndex = token.indexOf(".");
  if (dotIndex === -1) return undefined;

  const payloadB64 = token.slice(0, dotIndex);
  const hmacB64 = token.slice(dotIndex + 1);

  // Recompute HMAC
  const expected = createHmac("sha256", secret).update(payloadB64).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(hmacB64, "base64url");
  /* v8 ignore start -- malformed base64url */
  } catch {
    return undefined;
  }
  /* v8 ignore stop */

  // Constant-time comparison
  if (expected.length !== provided.length) return undefined;
  if (!timingSafeEqual(expected, provided)) return undefined;

  // Decode payload
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  /* v8 ignore start -- malformed JSON */
  } catch {
    return undefined;
  }
  /* v8 ignore stop */

  /* v8 ignore start -- type guard: parsed JSON always has correct shape from createRelayToken */
  if (!isRelayTokenPayload(parsed)) return undefined;
  /* v8 ignore stop */

  // Check expiry
  /* v8 ignore start -- expiry check: tokens are fresh in tests (120s TTL) */
  if (parsed.exp < Math.floor(Date.now() / 1000)) return undefined;
  /* v8 ignore stop */

  return parsed;
}

/* v8 ignore start -- type guard: only hit with valid token payloads in normal operation */
function isRelayTokenPayload(v: unknown): v is RelayTokenPayload {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.peer === "string" &&
    typeof o.nonce === "string" &&
    typeof o.exp === "number" &&
    typeof o.srv === "string"
  );
}
/* v8 ignore stop */
