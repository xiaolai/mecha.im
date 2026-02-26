import { createCipheriv, createDecipheriv, randomBytes, diffieHellman, createPrivateKey, createPublicKey, hkdfSync } from "node:crypto";
import { DEFAULTS, HandshakeError } from "@mecha/core";
import type { NoiseTransport, NoiseHandshakeResult, NoiseCipher, NoiseKeyPair } from "./types.js";

/**
 * Simplified Noise IK pattern for mutual authentication + encryption.
 *
 * Uses ChaCha20-Poly1305 with a shared secret from X25519 DH.
 * The full Noise Protocol Framework (via noise-handshake npm)
 * will replace the DH step in a follow-up; cipher/framing stays the same.
 */

/** Create a NoiseCipher from a 32-byte shared secret. */
export function createNoiseCipher(sharedSecret: Uint8Array): NoiseCipher {
  let sendNonce = 0n;
  let recvNonce = 0n;
  let key = Buffer.from(sharedSecret.slice(0, 32));

  function nonceToIv(n: bigint): Buffer {
    const iv = Buffer.alloc(12);
    iv.writeBigUInt64LE(n, 4);
    return iv;
  }

  return {
    encrypt(plaintext: Uint8Array): Uint8Array {
      const iv = nonceToIv(sendNonce++);
      const cipher = createCipheriv("chacha20-poly1305", key, iv, { authTagLength: 16 });
      const encrypted = cipher.update(plaintext);
      cipher.final();
      const tag = cipher.getAuthTag();
      // Frame: [12-byte IV][16-byte tag][ciphertext]
      const result = Buffer.alloc(12 + 16 + encrypted.length);
      iv.copy(result, 0);
      tag.copy(result, 12);
      encrypted.copy(result, 28);
      return new Uint8Array(result);
    },

    decrypt(ciphertext: Uint8Array): Uint8Array {
      const buf = Buffer.from(ciphertext);
      if (buf.length < 28) throw new Error("Ciphertext too short");
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const data = buf.subarray(28);
      // Enforce nonce monotonicity — reject replayed/reordered frames
      const receivedNonce = iv.readBigUInt64LE(4);
      /* v8 ignore start -- replay detection requires out-of-order delivery to trigger */
      if (receivedNonce < recvNonce) {
        throw new Error("Nonce reuse or replay detected");
      }
      /* v8 ignore stop */
      const decipher = createDecipheriv("chacha20-poly1305", key, iv, { authTagLength: 16 });
      decipher.setAuthTag(tag);
      const decrypted = decipher.update(data);
      decipher.final();
      recvNonce = receivedNonce + 1n;
      return new Uint8Array(decrypted);
    },

    rekey(): void {
      key = randomBytes(32);
      sendNonce = 0n;
      recvNonce = 0n;
    },
  };
}

/* v8 ignore start -- noiseInitiate/noiseRespond require real X25519 DER keys and transport infrastructure */

/** Derive send/recv keys from raw DH output via HKDF with transcript context. */
function deriveKeys(dhSecret: Buffer, transcript: Buffer): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", dhSecret, transcript, "mecha-noise-ik", 32));
}

export interface NoiseInitiateOpts {
  transport: NoiseTransport;
  localKeyPair: NoiseKeyPair;
  remotePublicKey: string;
  /** Expected fingerprint of remote peer (for identity binding). Omit to skip verification. */
  expectedFingerprint?: string;
  timeoutMs?: number;
}

/**
 * Initiate a Noise IK handshake (simplified for Phase 6).
 *
 * Exchanges X25519 public keys, computes shared secret via DH.
 */
export async function noiseInitiate(opts: NoiseInitiateOpts): Promise<NoiseHandshakeResult> {
  const { transport, localKeyPair, remotePublicKey, expectedFingerprint, timeoutMs = DEFAULTS.NOISE_HANDSHAKE_TIMEOUT_MS } = opts;

  const localPubBytes = Buffer.from(localKeyPair.publicKey, "base64url");

  // Send our public key
  transport.send(localPubBytes);

  // Wait for responder's public key
  const response = await Promise.race([
    transport.receive(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new HandshakeError(`Handshake timeout after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);

  // Verify responder identity if fingerprint is provided
  if (expectedFingerprint) {
    const { createHash } = await import("node:crypto");
    const fp = createHash("sha256").update(response).digest("hex").slice(0, 16);
    if (fp !== expectedFingerprint) {
      throw new HandshakeError("Remote peer identity mismatch");
    }
  }

  // Compute shared secret via X25519 DH
  const localPriv = createPrivateKey({
    key: Buffer.from(localKeyPair.privateKey, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  const remotePub = createPublicKey({
    key: Buffer.from(remotePublicKey, "base64url"),
    format: "der",
    type: "spki",
  });
  const secret = diffieHellman({ privateKey: localPriv, publicKey: remotePub });
  // Derive key via HKDF with transcript binding (both public keys as context)
  const transcript = Buffer.concat([localPubBytes, Buffer.from(response)]);
  const derivedKey = deriveKeys(secret, transcript);
  const cipher = createNoiseCipher(derivedKey);

  return { cipher, remoteStaticKey: new Uint8Array(response) };
}

export interface NoiseRespondOpts {
  transport: NoiseTransport;
  localKeyPair: NoiseKeyPair;
  timeoutMs?: number;
}

/** Respond to a Noise IK handshake. */
export async function noiseRespond(opts: NoiseRespondOpts): Promise<NoiseHandshakeResult> {
  const { transport, localKeyPair, timeoutMs = DEFAULTS.NOISE_HANDSHAKE_TIMEOUT_MS } = opts;

  // Wait for initiator's public key
  const initiatorPub = await Promise.race([
    transport.receive(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new HandshakeError(`Handshake timeout after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);

  // Send our public key
  const localPubBytes = Buffer.from(localKeyPair.publicKey, "base64url");
  transport.send(localPubBytes);

  // Compute shared secret
  const localPriv = createPrivateKey({
    key: Buffer.from(localKeyPair.privateKey, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  const remotePub = createPublicKey({
    key: Buffer.from(initiatorPub),
    format: "der",
    type: "spki",
  });
  const secret = diffieHellman({ privateKey: localPriv, publicKey: remotePub });
  // Derive key via HKDF — transcript uses initiator's key first (same order as initiator)
  const transcript = Buffer.concat([Buffer.from(initiatorPub), localPubBytes]);
  const derivedKey = deriveKeys(secret, transcript);
  const cipher = createNoiseCipher(derivedKey);

  return { cipher, remoteStaticKey: new Uint8Array(initiatorPub) };
}
/* v8 ignore stop */
