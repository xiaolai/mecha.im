import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { safeReadJson } from "./safe-read.js";
import { addNode, readNodes, type NodeEntry } from "./node-registry.js";

const DISCOVERED_FILE = "nodes-discovered.json";

const DiscoveredNodeSchema = z.object({
  name: z.string(),
  host: z.string(),
  port: z.number().int().nonnegative(),
  apiKey: z.string(),
  fingerprint: z.string().optional(),
  source: z.enum(["tailscale", "mdns"]),
  lastSeen: z.string().datetime(),
  addedAt: z.string().datetime(),
});

export type DiscoveredNode = z.infer<typeof DiscoveredNodeSchema>;

const DiscoveredArraySchema = z.array(DiscoveredNodeSchema);

function discoveredPath(mechaDir: string): string {
  return join(mechaDir, DISCOVERED_FILE);
}

export function readDiscoveredNodes(mechaDir: string): DiscoveredNode[] {
  const result = safeReadJson(discoveredPath(mechaDir), "discovered nodes", DiscoveredArraySchema);
  if (!result.ok) return [];
  return result.data;
}

function writeDiscoveredNodes(mechaDir: string, nodes: DiscoveredNode[]): void {
  const path = discoveredPath(mechaDir);
  const tmp = path + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(nodes, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

/** Write or update a discovered node entry. Updates lastSeen if already exists. */
export function writeDiscoveredNode(mechaDir: string, node: DiscoveredNode): void {
  DiscoveredNodeSchema.parse(node);
  const nodes = readDiscoveredNodes(mechaDir);
  const idx = nodes.findIndex((n) => n.name === node.name);
  if (idx >= 0) {
    nodes[idx] = { ...nodes[idx]!, ...node, addedAt: nodes[idx]!.addedAt };
  } else {
    nodes.push(node);
  }
  writeDiscoveredNodes(mechaDir, nodes);
}

/** Bulk-update lastSeen for nodes matching the given hosts. Single file write. */
export function refreshDiscoveredNodes(mechaDir: string, hosts: Set<string>, lastSeen: string): number {
  const nodes = readDiscoveredNodes(mechaDir);
  let updated = 0;
  for (const node of nodes) {
    if (hosts.has(node.host)) {
      node.lastSeen = lastSeen;
      updated++;
    }
  }
  if (updated > 0) writeDiscoveredNodes(mechaDir, nodes);
  return updated;
}

/** Remove a discovered node. Returns false if not found. */
export function removeDiscoveredNode(mechaDir: string, name: string): boolean {
  const nodes = readDiscoveredNodes(mechaDir);
  const filtered = nodes.filter((n) => n.name !== name);
  if (filtered.length === nodes.length) return false;
  writeDiscoveredNodes(mechaDir, filtered);
  return true;
}

/** Remove nodes not seen within ttlMs. Returns names of removed nodes. */
export function cleanupExpiredNodes(mechaDir: string, ttlMs: number): string[] {
  const nodes = readDiscoveredNodes(mechaDir);
  const now = Date.now();
  const removed: string[] = [];
  const kept = nodes.filter((n) => {
    const age = now - new Date(n.lastSeen).getTime();
    if (age > ttlMs) {
      removed.push(n.name);
      return false;
    }
    return true;
  });
  if (removed.length > 0) writeDiscoveredNodes(mechaDir, kept);
  return removed;
}

/** Promote a discovered node to manual nodes.json. Returns the NodeEntry or undefined. */
export function promoteDiscoveredNode(mechaDir: string, name: string): NodeEntry | undefined {
  const nodes = readDiscoveredNodes(mechaDir);
  const discovered = nodes.find((n) => n.name === name);
  if (!discovered) return undefined;

  const entry: NodeEntry = {
    name: discovered.name,
    host: discovered.host,
    port: discovered.port,
    apiKey: discovered.apiKey,
    addedAt: new Date().toISOString(),
  };

  const manual = readNodes(mechaDir);
  if (!manual.some((n) => n.name === name)) {
    addNode(mechaDir, entry);
  }

  removeDiscoveredNode(mechaDir, name);
  return entry;
}
