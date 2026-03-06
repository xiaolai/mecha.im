import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { createNodeIdentity, loadNodeIdentity } from "@mecha/core";

/** Result of initializing the mecha directory. */
export interface InitResult {
  mechaDir: string;
  nodeId: string;
  fingerprint?: string;
  created: boolean;
}

/**
 * Initializes the ~/.mecha/ directory structure and node identity.
 */
export function mechaInit(mechaDir: string): InitResult {
  // Validate mechaDir is under user home directory
  const home = homedir();
  const resolved = join(mechaDir); // normalize
  /* v8 ignore start -- defensive warning for non-standard mechaDir */
  if (!resolved.startsWith(home)) {
    console.warn(`[mecha] Warning: mechaDir "${resolved}" is outside home directory "${home}"`);
  }
  /* v8 ignore stop */

  const existed = existsSync(mechaDir);

  // Create directory structure with restrictive permissions
  mkdirSync(join(mechaDir, "auth"), { recursive: true, mode: 0o700 });
  mkdirSync(join(mechaDir, "tools"), { recursive: true, mode: 0o700 });
  mkdirSync(join(mechaDir, "logs"), { recursive: true, mode: 0o700 });

  // Create empty discovery index if missing
  const discoveryPath = join(mechaDir, "discovery.json");
  if (!existsSync(discoveryPath)) {
    writeFileSync(discoveryPath, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), bots: [] }, null, 2) + "\n", { mode: 0o600 });
  }

  // Generate or read node-id
  const nodeIdPath = join(mechaDir, "node-id");
  let nodeId: string;
  if (existsSync(nodeIdPath)) {
    nodeId = readFileSync(nodeIdPath, "utf-8").trim();
  } else {
    nodeId = randomUUID();
    writeFileSync(nodeIdPath, nodeId + "\n", { mode: 0o600 });
  }

  // Create or load node identity (Ed25519 keypair)
  const nodeIdentity = loadNodeIdentity(mechaDir) ?? createNodeIdentity(mechaDir);

  return {
    mechaDir,
    nodeId,
    fingerprint: nodeIdentity.fingerprint,
    created: !existed,
  };
}
