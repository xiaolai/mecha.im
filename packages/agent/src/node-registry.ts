import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { DEFAULTS } from "@mecha/core";

export interface NodeEntry {
  name: string;
  host: string;
  key: string;
}

function nodesPath(): string {
  return join(homedir(), DEFAULTS.HOME_DIR, "nodes.json");
}

function ensureDir(): void {
  mkdirSync(join(homedir(), DEFAULTS.HOME_DIR), { recursive: true });
}

function isNodeEntry(v: unknown): v is NodeEntry {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as NodeEntry).name === "string" &&
    typeof (v as NodeEntry).host === "string" &&
    typeof (v as NodeEntry).key === "string"
  );
}

export function readNodes(): NodeEntry[] {
  try {
    const raw = readFileSync(nodesPath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isNodeEntry);
  } catch (err) {
    // Only ignore missing file; surface parse/permission errors
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export async function readNodesAsync(): Promise<NodeEntry[]> {
  try {
    const raw = await readFile(nodesPath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isNodeEntry);
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export function writeNodes(nodes: NodeEntry[]): void {
  ensureDir();
  writeFileSync(nodesPath(), JSON.stringify(nodes, null, 2) + "\n", { mode: 0o600 });
}

export function addNode(name: string, host: string, key: string): NodeEntry {
  const nodes = readNodes();
  const existing = nodes.find((n) => n.name === name);
  if (existing) {
    throw new Error(`Node "${name}" already exists`);
  }
  const entry: NodeEntry = { name, host, key };
  nodes.push(entry);
  writeNodes(nodes);
  return entry;
}

export function removeNode(name: string): void {
  const nodes = readNodes();
  const idx = nodes.findIndex((n) => n.name === name);
  if (idx === -1) {
    throw new Error(`Node "${name}" not found`);
  }
  nodes.splice(idx, 1);
  writeNodes(nodes);
}
