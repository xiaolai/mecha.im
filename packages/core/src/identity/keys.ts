import { generateKeyPairSync, createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export interface KeyPair {
  publicKey: string;   // PEM-encoded Ed25519 public key
  privateKey: string;  // PEM-encoded Ed25519 private key
}

/** Generate a new Ed25519 keypair. */
export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

/** Compute a fingerprint from a PEM public key: SHA-256, hex, truncated to 16 chars. */
export function fingerprint(publicKeyPem: string): string {
  // Extract raw DER bytes from PEM
  const lines = publicKeyPem.split("\n").filter((l) => !l.startsWith("-----") && l.trim() !== "");
  const der = Buffer.from(lines.join(""), "base64");
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

/** Load a PEM private key from a file path. */
/* v8 ignore start -- utility used by node-identity, tested transitively */
export function loadPrivateKey(keyPath: string): string {
  return readFileSync(keyPath, "utf-8");
}
/* v8 ignore stop */
