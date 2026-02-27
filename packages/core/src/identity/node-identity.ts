import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { IDENTITY_DIR } from "../constants.js";
import { generateKeyPair, fingerprint } from "./keys.js";
import { createNoiseKeys } from "./noise-keys.js";
import { safeReadJson } from "../safe-read.js";

export interface NodeIdentity {
  readonly id: string;
  readonly publicKey: string;
  readonly fingerprint: string;
  readonly createdAt: string;
}

/* v8 ignore start -- type guard only hit with valid data in normal operation */
function isNodeIdentity(v: unknown): v is NodeIdentity {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.publicKey === "string" &&
    typeof o.fingerprint === "string" &&
    typeof o.createdAt === "string"
  );
}
/* v8 ignore stop */

/** Create a node identity with Ed25519 keypair. Writes to mechaDir/identity/. */
export function createNodeIdentity(mechaDir: string): NodeIdentity {
  const identityDir = join(mechaDir, IDENTITY_DIR);
  mkdirSync(identityDir, { recursive: true, mode: 0o700 });

  const nodePath = join(identityDir, "node.json");
  const keyPath = join(identityDir, "node.key");

  // If identity already exists, return it
  const existing = loadNodeIdentity(mechaDir);
  if (existing) return existing;

  const kp = generateKeyPair();
  const fp = fingerprint(kp.publicKey);

  // Read existing node ID if present (from Phase 1 init), or generate new
  let nodeId: string;
  const nodeIdPath = join(mechaDir, "node-id");
  if (existsSync(nodeIdPath)) {
    nodeId = readFileSync(nodeIdPath, "utf-8").trim();
  } else {
    nodeId = randomUUID();
    // Persist node-id for backward compatibility with Phase 1
    writeFileSync(nodeIdPath, nodeId + "\n", { mode: 0o600 });
  }

  const identity: NodeIdentity = {
    id: nodeId,
    publicKey: kp.publicKey,
    fingerprint: fp,
    createdAt: new Date().toISOString(),
  };

  // Atomic write identity JSON
  const tmpJson = nodePath + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmpJson, JSON.stringify(identity, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmpJson, nodePath);

  // Write private key
  const tmpKey = keyPath + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmpKey, kp.privateKey, { mode: 0o600 });
  renameSync(tmpKey, keyPath);

  // Generate X25519 noise keys for P2P encryption (Phase 6)
  createNoiseKeys(mechaDir);

  return identity;
}

/** Load existing node identity from mechaDir/identity/. Returns undefined if missing. */
export function loadNodeIdentity(mechaDir: string): NodeIdentity | undefined {
  const nodePath = join(mechaDir, IDENTITY_DIR, "node.json");
  const result = safeReadJson<unknown>(nodePath, "node identity");
  if (!result.ok) {
    /* v8 ignore start -- corrupt/unreadable identity fallback */
    if (result.reason !== "missing") {
      console.error(`[mecha] ${result.detail}`);
    }
    /* v8 ignore stop */
    return undefined;
  }
  /* v8 ignore start -- corrupt identity: throw to prevent silent key rotation */
  if (!isNodeIdentity(result.data)) {
    throw new Error("[mecha] node identity: schema validation failed — manual repair required");
  }
  /* v8 ignore stop */
  return result.data;
}

/** Load node private key PEM. Returns undefined if missing. */
export function loadNodePrivateKey(mechaDir: string): string | undefined {
  const keyPath = join(mechaDir, IDENTITY_DIR, "node.key");
  if (!existsSync(keyPath)) return undefined;
  try {
    return readFileSync(keyPath, "utf-8");
  /* v8 ignore start -- corrupt file fallback */
  } catch {
    return undefined;
  }
  /* v8 ignore stop */
}
