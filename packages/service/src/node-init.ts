import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import type { NodeName } from "@mecha/core";
import { isValidName, InvalidNameError, CorruptConfigError, safeReadJson, createNodeIdentity } from "@mecha/core";

const NODE_FILE = "node.json";

interface NodeConfig {
  name: string;
  createdAt: string;
}

export interface NodeInitResult {
  name: NodeName;
  created: boolean;
}

/**
 * Initialize this machine as a named node.
 * Auto-generates name from os.hostname() + 4-char hash if no name provided.
 * Idempotent: returns existing name if already initialized.
 */
export function nodeInit(mechaDir: string, opts?: { name?: string }): NodeInitResult {
  const nodePath = join(mechaDir, NODE_FILE);

  if (existsSync(nodePath)) {
    try {
      const raw = JSON.parse(readFileSync(nodePath, "utf-8")) as NodeConfig;
      if (!isValidName(raw.name)) throw new InvalidNameError(raw.name);
      return { name: raw.name as NodeName, created: false };
    /* v8 ignore start -- corrupt node.json fallback */
    } catch (err) {
      if (err instanceof InvalidNameError) throw err;
      throw new CorruptConfigError("node.json");
    }
    /* v8 ignore stop */
  }

  const name = opts?.name ?? generateNodeName();
  if (!isValidName(name)) throw new InvalidNameError(name);

  const config: NodeConfig = { name, createdAt: new Date().toISOString() };
  writeFileSync(nodePath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });

  // Ensure identity + noise keys exist (required for invite/join)
  createNodeIdentity(mechaDir);

  return { name: name as NodeName, created: true };
}

/** Read the current node name, if initialized. */
export function readNodeName(mechaDir: string): NodeName | undefined {
  const nodePath = join(mechaDir, NODE_FILE);
  const result = safeReadJson<NodeConfig>(nodePath, "node config");
  if (!result.ok) {
    /* v8 ignore start -- corrupt/unreadable node config fallback */
    if (result.reason !== "missing") {
      console.error(`[mecha] ${result.detail}`);
    }
    /* v8 ignore stop */
    return undefined;
  }
  if (typeof result.data.name !== "string" || !isValidName(result.data.name)) return undefined;
  return result.data.name as NodeName;
}

function generateNodeName(): string {
  const host = hostname().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  let stem = host;
  /* v8 ignore start -- empty hostname fallback (only on machines with non-alphanumeric hostnames) */
  if (!stem) stem = "node";
  /* v8 ignore stop */
  const hash = createHash("sha256").update(hostname()).digest("hex").slice(0, 4);
  // Reserve 5 chars for "-" + 4-char hash, truncate stem, trim trailing "-"
  const truncated = stem.slice(0, 27).replace(/-$/, "");
  return `${truncated}-${hash}`;
}
