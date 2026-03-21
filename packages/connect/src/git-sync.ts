import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

/** A bundle of file paths mapped to their base64-encoded contents. */
export interface SyncBundle {
  files: Record<string, string>;
}

/** Options for syncing a bundle to a remote node. */
export interface SyncToNodeOpts {
  localDir: string;
  remotePath: string;
  /** Fetch function that sends the bundle to the remote node. */
  fetchFn: (body: { remotePath: string; bundle: SyncBundle }) => Promise<{ status: number }>;
}

/**
 * Recursively collect all files in a directory, returning paths relative to `dir`.
 * Skips hidden directories (dot-prefixed) except `.claude`.
 * Skips `node_modules`.
 */
function collectFiles(dir: string, base: string = ""): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") && entry.name !== ".claude") continue;
      if (entry.name === "node_modules") continue;
      result.push(...collectFiles(join(dir, entry.name), relPath));
    } else if (entry.isFile()) {
      result.push(relPath);
    }
  }
  return result;
}

/**
 * Create a sync bundle from all files in a directory.
 * File contents are base64-encoded to handle binary files safely.
 */
export function createSyncBundle(dir: string): SyncBundle {
  const files: Record<string, string> = {};
  const paths = collectFiles(dir);
  for (const p of paths) {
    const content = readFileSync(join(dir, p));
    files[p] = content.toString("base64");
  }
  return { files };
}

/**
 * Apply a sync bundle to a directory.
 * Creates subdirectories as needed; writes all files from the bundle.
 * Returns the list of relative paths written.
 */
export function applySyncBundle(dir: string, bundle: SyncBundle): string[] {
  const written: string[] = [];
  const resolvedDir = resolve(dir);
  for (const [relPath, b64Content] of Object.entries(bundle.files)) {
    const fullPath = resolve(dir, relPath);
    /* v8 ignore start -- path traversal guard for sync bundles */
    if (!fullPath.startsWith(resolvedDir + "/") && fullPath !== resolvedDir) {
      throw new Error(`Path traversal rejected: "${relPath}" escapes target directory`);
    }
    /* v8 ignore stop */
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, Buffer.from(b64Content, "base64"));
    written.push(relPath);
  }
  return written;
}

/**
 * Send a sync bundle to a remote node.
 * Creates the bundle from localDir and passes it to the provided fetchFn.
 */
export async function syncToNode(opts: SyncToNodeOpts): Promise<{ filesCount: number; status: number }> {
  const { localDir, remotePath, fetchFn } = opts;
  const bundle = createSyncBundle(localDir);
  const filesCount = Object.keys(bundle.files).length;
  const { status } = await fetchFn({ remotePath, bundle });
  return { filesCount, status };
}
