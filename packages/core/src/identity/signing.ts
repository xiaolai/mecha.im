import { sign, verify, createPrivateKey, createPublicKey } from "node:crypto";

/** Sign data with a PEM-encoded Ed25519 private key. Returns base64 signature. */
export function signMessage(privateKeyPem: string, data: Uint8Array): string {
  const key = createPrivateKey(privateKeyPem);
  const sig = sign(null, Buffer.from(data), key);
  return sig.toString("base64");
}

/** Verify a base64 signature against a PEM-encoded Ed25519 public key. */
export function verifySignature(
  publicKeyPem: string,
  data: Uint8Array,
  signatureBase64: string,
): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    return verify(null, Buffer.from(data), key, Buffer.from(signatureBase64, "base64"));
  /* v8 ignore start -- malformed key/signature from untrusted input */
  } catch {
    return false;
  }
  /* v8 ignore stop */
}
