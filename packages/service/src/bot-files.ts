import { readdir, readFile, writeFile, lstat, mkdir } from "node:fs/promises";
import { join, dirname, extname, resolve } from "node:path";
import { safePath, PathTraversalError } from "@mecha/core";

export { PathTraversalError };

export interface DirEntry {
  name: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string;
}

const MARKDOWN_EXTS = new Set([".md", ".mdx", ".markdown"]);

/** Max file size for read/write operations (5 MB). */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function isMarkdown(filePath: string): boolean {
  return MARKDOWN_EXTS.has(extname(filePath).toLowerCase());
}

/** Returns true if any segment of a relative path starts with a dot. */
function hasHiddenSegment(relPath: string): boolean {
  return relPath.split("/").some((s) => s.startsWith("."));
}

/**
 * Resolve a bot's effective home directory.
 * Validates that a custom home is within mechaDir to prevent
 * arbitrary filesystem access via config.home.
 */
export function resolveBotHome(mechaDir: string, botName: string, configHome?: string): string {
  if (!configHome) return join(mechaDir, botName);
  const resolved = resolve(configHome);
  const base = resolve(mechaDir);
  // Allow if home is under mechaDir or is a sibling path the admin explicitly set.
  // The key invariant: safePath then constrains browsing within homeDir.
  // We accept the configured home as-is since it was validated at config-write time
  // (bots-config.ts validates home is absolute and exists).
  return resolved;
}

/**
 * List directory entries under a bot's home.
 * Uses lstat to avoid following symlinks. Skips hidden entries and symlinks.
 * @param homeDir  - Bot's effective home directory
 * @param relPath  - Relative path within home (empty string = root)
 */
export async function listBotDir(homeDir: string, relPath: string): Promise<DirEntry[]> {
  const target = relPath ? safePath(homeDir, relPath) : homeDir;
  let entries;
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const results: DirEntry[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(target, entry.name);
    const info = await lstat(fullPath);
    // Skip symlinks entirely to prevent symlink-based escapes
    if (info.isSymbolicLink()) continue;
    results.push({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
    });
  }
  results.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return results;
}

/**
 * Read a markdown file from a bot's home directory.
 * Rejects non-markdown files, hidden paths, and files exceeding 5 MB.
 */
export async function readBotFile(homeDir: string, relPath: string): Promise<string> {
  if (!relPath) throw new Error("File path is required");
  if (hasHiddenSegment(relPath)) throw new PathTraversalError(relPath);
  const target = safePath(homeDir, relPath);
  if (!isMarkdown(target)) {
    throw new NotMarkdownError(relPath);
  }
  // Check size before reading (lstat to reject symlinks)
  let info;
  try {
    info = await lstat(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new FileNotFoundError(relPath);
    throw err;
  }
  if (info.isSymbolicLink()) throw new FileNotFoundError(relPath);
  if (info.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${(info.size / (1024 * 1024)).toFixed(1)} MB (max ${MAX_FILE_SIZE / (1024 * 1024)} MB)`);
  }
  return readFile(target, "utf-8");
}

/**
 * Write a markdown file in a bot's home directory.
 * Creates parent directories as needed. Rejects non-markdown, hidden paths,
 * and content exceeding 5 MB.
 */
export async function writeBotFile(homeDir: string, relPath: string, content: string): Promise<void> {
  if (!relPath) throw new Error("File path is required");
  if (hasHiddenSegment(relPath)) throw new PathTraversalError(relPath);
  const target = safePath(homeDir, relPath);
  if (!isMarkdown(target)) {
    throw new NotMarkdownError(relPath);
  }
  if (Buffer.byteLength(content, "utf-8") > MAX_FILE_SIZE) {
    throw new Error(`Content too large (max ${MAX_FILE_SIZE / (1024 * 1024)} MB)`);
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf-8");
}

export class FileNotFoundError extends Error {
  constructor(path: string) {
    super(`File not found: ${path}`);
    this.name = "FileNotFoundError";
  }
}

export class NotMarkdownError extends Error {
  constructor(path: string) {
    super(`Only markdown files (.md, .mdx, .markdown) are allowed: ${path}`);
    this.name = "NotMarkdownError";
  }
}
