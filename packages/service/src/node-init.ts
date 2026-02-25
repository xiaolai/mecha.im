import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import type { NodeName } from "@mecha/core";
import { isValidName, InvalidNameError } from "@mecha/core";

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
    const raw = JSON.parse(readFileSync(nodePath, "utf-8")) as NodeConfig;
    return { name: raw.name as NodeName, created: false };
  }

  const name = opts?.name ?? generateNodeName();
  if (!isValidName(name)) throw new InvalidNameError(name);

  const config: NodeConfig = { name, createdAt: new Date().toISOString() };
  writeFileSync(nodePath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });

  return { name: name as NodeName, created: true };
}

/** Read the current node name, if initialized. */
export function readNodeName(mechaDir: string): NodeName | undefined {
  const nodePath = join(mechaDir, NODE_FILE);
  if (!existsSync(nodePath)) return undefined;
  const raw = JSON.parse(readFileSync(nodePath, "utf-8")) as NodeConfig;
  return raw.name as NodeName;
}

function generateNodeName(): string {
  const host = hostname().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const hash = createHash("sha256").update(hostname()).digest("hex").slice(0, 4);
  const name = `${host}-${hash}`;
  // Truncate to fit name max length
  return name.slice(0, 32);
}
