import { readdir, writeFile, lstat, mkdir, open } from "node:fs/promises";
import { join, dirname, extname, resolve } from "node:path";
import { constants } from "node:fs";
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
  return relPath.split(/[/\\]/).some((s) => s.startsWith("."));
}

/**
 * Resolve a bot's effective home directory.
 * When configHome is set, it is used as-is (validated at config-write time).
 * Browsing within the returned home is constrained by safePath.
 */
export function resolveBotHome(mechaDir: string, botName: string, configHome?: string): string {
  if (!configHome) return join(mechaDir, botName);
  return resolve(configHome);
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
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
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
  // Open with O_NOFOLLOW to reject symlinks atomically (no TOCTOU gap)
  let fh;
  try {
    fh = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ELOOP") throw new FileNotFoundError(relPath);
    throw err;
  }
  try {
    const info = await fh.stat();
    if (!info.isFile()) throw new FileNotFoundError(relPath);
    if (info.size > MAX_FILE_SIZE) {
      throw new FileTooLargeError(info.size, MAX_FILE_SIZE);
    }
    return await fh.readFile("utf-8");
  } finally {
    await fh.close();
  }
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
    throw new FileTooLargeError(Buffer.byteLength(content, "utf-8"), MAX_FILE_SIZE);
  }
  const dir = dirname(target);
  await mkdir(dir, { recursive: true });
  // Verify parent dir is not a symlink (prevents symlink swap after mkdir)
  const parentInfo = await lstat(dir);
  if (parentInfo.isSymbolicLink()) throw new PathTraversalError(relPath);
  // Write via O_NOFOLLOW fd to prevent target symlink swap between lstat and write
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW;
  const fh = await open(target, flags, 0o644);
  try {
    await fh.writeFile(content, "utf-8");
  } finally {
    await fh.close();
  }
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

export class FileTooLargeError extends Error {
  constructor(actual: number, max: number) {
    super(`File too large: ${(actual / (1024 * 1024)).toFixed(1)} MB (max ${max / (1024 * 1024)} MB)`);
    this.name = "FileTooLargeError";
  }
}
