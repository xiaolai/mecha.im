import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { IDENTITY_DIR } from "../constants.js";

export interface NoiseKeyPair {
  publicKey: string;   // base64url-encoded X25519 public DER
  privateKey: string;  // base64url-encoded X25519 private DER
}

/** Generate a new X25519 keypair for Noise DH. Returns base64url-encoded DER keys. */
export function generateNoiseKeyPair(): NoiseKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("x25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return {
    publicKey: (publicKey as Buffer).toString("base64url"),
    privateKey: (privateKey as Buffer).toString("base64url"),
  };
}

/** Create and persist X25519 noise keys alongside Ed25519 identity keys. Idempotent. */
export function createNoiseKeys(mechaDir: string): NoiseKeyPair {
  const existing = loadNoiseKeyPair(mechaDir);
  if (existing) return existing;

  const identityDir = join(mechaDir, IDENTITY_DIR);
  mkdirSync(identityDir, { recursive: true, mode: 0o700 });

  const kp = generateNoiseKeyPair();

  const pubPath = join(identityDir, "noise.pub");
  const keyPath = join(identityDir, "noise.key");

  // Atomic write public key
  const tmpPub = pubPath + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmpPub, kp.publicKey + "\n", { mode: 0o644 });
  renameSync(tmpPub, pubPath);

  // Atomic write private key
  const tmpKey = keyPath + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmpKey, kp.privateKey + "\n", { mode: 0o600 });
  renameSync(tmpKey, keyPath);

  return kp;
}

/** Load existing X25519 noise keypair from mechaDir/identity/. Returns undefined if missing. */
export function loadNoiseKeyPair(mechaDir: string): NoiseKeyPair | undefined {
  const identityDir = join(mechaDir, IDENTITY_DIR);
  const pubPath = join(identityDir, "noise.pub");
  const keyPath = join(identityDir, "noise.key");

  /* v8 ignore start -- pub and key are always created together; partial-existence is defensive */
  if (!existsSync(pubPath) || !existsSync(keyPath)) return undefined;
  /* v8 ignore stop */

  try {
    const publicKey = readFileSync(pubPath, "utf-8").trim();
    const privateKey = readFileSync(keyPath, "utf-8").trim();
    /* v8 ignore start -- empty key file is a corrupt-state defensive guard */
    if (!publicKey || !privateKey) return undefined;
    /* v8 ignore stop */
    return { publicKey, privateKey };
  /* v8 ignore start -- corrupt file fallback */
  } catch {
    return undefined;
  }
  /* v8 ignore stop */
}

/** Load only the noise public key. Returns undefined if missing. */
export function loadNoisePublicKey(mechaDir: string): string | undefined {
  const pubPath = join(mechaDir, IDENTITY_DIR, "noise.pub");
  if (!existsSync(pubPath)) return undefined;
  try {
    /* v8 ignore start -- empty pub file is a corrupt-state defensive guard */
    return readFileSync(pubPath, "utf-8").trim() || undefined;
    /* v8 ignore stop */
  /* v8 ignore start -- corrupt file fallback */
  } catch {
    return undefined;
  }
  /* v8 ignore stop */
}
