import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { NodeName } from "./types.js";
import { isValidName } from "./validation.js";
import { InvalidNameError, DuplicateNodeError, NodeNotFoundError } from "./errors.js";

const NODES_FILE = "nodes.json";

const NodeEntrySchema = z.object({
  name: z.string(),
  host: z.string(),
  port: z.number().int().positive(),
  apiKey: z.string(),
  publicKey: z.string().optional(),
  addedAt: z.string(),
});

export type NodeEntry = z.infer<typeof NodeEntrySchema>;

const NodesArraySchema = z.array(NodeEntrySchema);

function nodesPath(mechaDir: string): string {
  return join(mechaDir, NODES_FILE);
}

/** Read all registered peer nodes. Returns empty array if file doesn't exist. */
export function readNodes(mechaDir: string): NodeEntry[] {
  const path = nodesPath(mechaDir);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  return NodesArraySchema.parse(JSON.parse(raw));
}

/** Write nodes array to disk (atomic overwrite). */
export function writeNodes(mechaDir: string, nodes: NodeEntry[]): void {
  writeFileSync(nodesPath(mechaDir), JSON.stringify(nodes, null, 2) + "\n", { mode: 0o600 });
}

/** Add a peer node. Throws DuplicateNodeError if name already registered. */
export function addNode(mechaDir: string, entry: NodeEntry): void {
  if (!isValidName(entry.name)) throw new InvalidNameError(entry.name);
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
