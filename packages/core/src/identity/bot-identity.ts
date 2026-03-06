import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import type { BotName } from "../types.js";
import { generateKeyPair, fingerprint } from "./keys.js";
import { signMessage } from "./signing.js";
import type { NodeIdentity } from "./node-identity.js";

export interface BotIdentity {
  readonly name: string;
  readonly nodeId: string;
  readonly publicKey: string;
  readonly nodePublicKey: string;
  readonly fingerprint: string;
  readonly signature: string;   // node signs bot public key to prove provenance
  readonly createdAt: string;
}

/* v8 ignore start -- type guard only hit with valid data in normal operation */
function isBotIdentity(v: unknown): v is BotIdentity {
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
 * Create a bot identity with Ed25519 keypair, signed by the node key.
 * Writes identity.json + bot.key to the bot directory.
 */
export function createBotIdentity(
  botDir: string,
  name: BotName,
  nodeIdentity: NodeIdentity,
  nodePrivateKeyPem: string,
): BotIdentity {
  // If identity already exists, return it
  const existing = loadBotIdentityFromDir(botDir);
  if (existing) return existing;

  mkdirSync(botDir, { recursive: true, mode: 0o700 });

  const kp = generateKeyPair();
  const fp = fingerprint(kp.publicKey);

  // Node signs the bot's public key
  const sig = signMessage(nodePrivateKeyPem, new TextEncoder().encode(kp.publicKey));

  const identity: BotIdentity = {
    name,
    nodeId: nodeIdentity.id,
    publicKey: kp.publicKey,
    nodePublicKey: nodeIdentity.publicKey,
    fingerprint: fp,
    signature: sig,
    createdAt: new Date().toISOString(),
  };

  const identityPath = join(botDir, "identity.json");
  const keyPath = join(botDir, "bot.key");

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

/** Load bot identity from a bot directory. Returns undefined if missing. */
export function loadBotIdentityFromDir(botDir: string): BotIdentity | undefined {
  const identityPath = join(botDir, "identity.json");
  if (!existsSync(identityPath)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(identityPath, "utf-8"));
    if (!isBotIdentity(parsed)) return undefined;
    return parsed;
  /* v8 ignore start -- corrupt file fallback */
  } catch {
    return undefined;
  }
  /* v8 ignore stop */
}

/** Load bot identity by name from mechaDir. Returns undefined if missing. */
export function loadBotIdentity(mechaDir: string, name: BotName): BotIdentity | undefined {
  // Validate name doesn't contain path traversal
  const resolved = join(mechaDir, name);
  /* v8 ignore start -- path traversal guard: name is validated before reaching here */
  const rel = relative(mechaDir, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  /* v8 ignore stop */
  return loadBotIdentityFromDir(resolved);
}
