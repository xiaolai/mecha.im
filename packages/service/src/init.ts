import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface InitResult {
  mechaDir: string;
  nodeId: string;
  created: boolean;
}

/**
 * Initializes the ~/.mecha/ directory structure.
 */
export function mechaInit(mechaDir: string): InitResult {
  const existed = existsSync(mechaDir);

  // Create directory structure with restrictive permissions
  mkdirSync(join(mechaDir, "auth"), { recursive: true, mode: 0o700 });
  mkdirSync(join(mechaDir, "tools"), { recursive: true, mode: 0o700 });
  mkdirSync(join(mechaDir, "logs"), { recursive: true, mode: 0o700 });

  // Generate or read node-id
  const nodeIdPath = join(mechaDir, "node-id");
  let nodeId: string;
  if (existsSync(nodeIdPath)) {
    nodeId = readFileSync(nodeIdPath, "utf-8").trim();
  } else {
    nodeId = randomUUID();
    writeFileSync(nodeIdPath, nodeId + "\n", { mode: 0o600 });
  }

  return {
    mechaDir,
    nodeId,
    created: !existed,
  };
}
