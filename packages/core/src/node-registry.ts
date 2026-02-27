import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { isValidName } from "./validation.js";
import { InvalidNameError, DuplicateNodeError, CorruptConfigError } from "./errors.js";
import { safeReadJson } from "./safe-read.js";

const NODES_FILE = "nodes.json";

/* v8 ignore start -- refine branch: managed=false short-circuits, publicKey-only branch unreachable */
const managedRequiresKeys = (n: { managed?: boolean; fingerprint?: string; publicKey?: string }): boolean =>
  !n.managed || !!(n.fingerprint && n.publicKey);
/* v8 ignore stop */

const NodeEntrySchema = z.object({
  name: z.string(),
  host: z.string(),
  port: z.number().int().nonnegative(),
  apiKey: z.string(),
  publicKey: z.string().optional(),
  noisePublicKey: z.string().optional(),
  fingerprint: z.string().optional(),
  addedAt: z.string(),
  managed: z.boolean().optional(),
  serverUrl: z.string().optional(),
}).refine(managedRequiresKeys, { message: "Managed nodes require publicKey and fingerprint" });

export type NodeEntry = z.infer<typeof NodeEntrySchema>;

const NodesArraySchema = z.array(NodeEntrySchema);

function nodesPath(mechaDir: string): string {
  return join(mechaDir, NODES_FILE);
}

/** Read all registered peer nodes. Returns empty array if file doesn't exist. Throws on corrupt data. */
export function readNodes(mechaDir: string): NodeEntry[] {
  const path = nodesPath(mechaDir);
  const result = safeReadJson(path, "node registry", NodesArraySchema);
  /* v8 ignore start -- corrupt/unreadable registry fallback */
  if (!result.ok) {
    if (result.reason === "missing") return [];
    throw new CorruptConfigError(`node registry: ${result.detail}`);
  }
  /* v8 ignore stop */
  return result.data;
}

/** Write nodes array to disk (atomic: temp file + rename). */
export function writeNodes(mechaDir: string, nodes: NodeEntry[]): void {
  const path = nodesPath(mechaDir);
  const tmp = path + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(nodes, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

/** Add a peer node. Throws DuplicateNodeError if name already registered. */
export function addNode(mechaDir: string, entry: NodeEntry): void {
  if (!isValidName(entry.name)) throw new InvalidNameError(entry.name);
  // Validate full entry shape via Zod
  NodeEntrySchema.parse(entry);
  const nodes = readNodes(mechaDir);
  if (nodes.some((n) => n.name === entry.name)) {
    throw new DuplicateNodeError(entry.name);
  }
  nodes.push(entry);
  writeNodes(mechaDir, nodes);
}

/** Remove a peer node by name. Returns false if not found. */
export function removeNode(mechaDir: string, name: string): boolean {
  if (!isValidName(name)) throw new InvalidNameError(name);
  const nodes = readNodes(mechaDir);
  const filtered = nodes.filter((n) => n.name !== name);
  if (filtered.length === nodes.length) return false;
  writeNodes(mechaDir, filtered);
  return true;
}

/** Get a single peer node by name. */
export function getNode(mechaDir: string, name: string): NodeEntry | undefined {
  if (!isValidName(name)) throw new InvalidNameError(name);
  const nodes = readNodes(mechaDir);
  return nodes.find((n) => n.name === name);
}
