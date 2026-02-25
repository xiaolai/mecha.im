import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { CasaName } from "../types.js";
import { generateKeyPair, fingerprint } from "./keys.js";
import { signMessage } from "./signing.js";
import type { NodeIdentity } from "./node-identity.js";

export interface CasaIdentity {
  readonly name: string;
  readonly nodeId: string;
  readonly publicKey: string;
  readonly nodePublicKey: string;
  readonly fingerprint: string;
  readonly signature: string;   // node signs CASA public key to prove provenance
  readonly createdAt: string;
}

/* v8 ignore start -- type guard only hit with valid data in normal operation */
function isCasaIdentity(v: unknown): v is CasaIdentity {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.name === "string" &&
    typeof o.nodeId === "string" &&
    typeof o.publicKey === "string" &&
    typeof o.nodePublicKey === "string" &&
    typeof o.fingerprint === "string" &&
    typeof o.signature === "string" &&
    typeof o.createdAt === "string"
  );
}
/* v8 ignore stop */

/**
 * Create a CASA identity with Ed25519 keypair, signed by the node key.
 * Writes identity.json + casa.key to the CASA directory.
 */
export function createCasaIdentity(
  casaDir: string,
  name: CasaName,
  nodeIdentity: NodeIdentity,
  nodePrivateKeyPem: string,
): CasaIdentity {
  // If identity already exists, return it
  const existing = loadCasaIdentityFromDir(casaDir);
  if (existing) return existing;

  mkdirSync(casaDir, { recursive: true, mode: 0o700 });

  const kp = generateKeyPair();
  const fp = fingerprint(kp.publicKey);

  // Node signs the CASA's public key
  const sig = signMessage(nodePrivateKeyPem, new TextEncoder().encode(kp.publicKey));

  const identity: CasaIdentity = {
    name,
    nodeId: nodeIdentity.id,
    publicKey: kp.publicKey,
    nodePublicKey: nodeIdentity.publicKey,
    fingerprint: fp,
    signature: sig,
    createdAt: new Date().toISOString(),
  };

  const identityPath = join(casaDir, "identity.json");
  const keyPath = join(casaDir, "casa.key");

  // Atomic write identity JSON
  const tmpJson = identityPath + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmpJson, JSON.stringify(identity, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmpJson, identityPath);

  // Write private key
  const tmpKey = keyPath + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmpKey, kp.privateKey, { mode: 0o600 });
  renameSync(tmpKey, keyPath);

  return identity;
}

/** Load CASA identity from a CASA directory. Returns undefined if missing. */
export function loadCasaIdentityFromDir(casaDir: string): CasaIdentity | undefined {
  const identityPath = join(casaDir, "identity.json");
  if (!existsSync(identityPath)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(identityPath, "utf-8"));
    if (!isCasaIdentity(parsed)) return undefined;
    return parsed;
  /* v8 ignore start -- corrupt file fallback */
  } catch {
    return undefined;
  }
  /* v8 ignore stop */
}

/** Load CASA identity by name from mechaDir. Returns undefined if missing. */
export function loadCasaIdentity(mechaDir: string, name: CasaName): CasaIdentity | undefined {
  return loadCasaIdentityFromDir(join(mechaDir, name));
}
