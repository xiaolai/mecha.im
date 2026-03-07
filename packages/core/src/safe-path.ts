import { resolve, relative, sep } from "node:path";
import { realpathSync, existsSync } from "node:fs";

/** Check if a relative path escapes its parent (platform-safe). */
function isEscape(rel: string): boolean {
  // path.relative() returns OS-native separators, so check both / and sep.
  // On Windows sep is \, on POSIX sep is / — covering both ensures safety.
  return rel === ".." || rel.startsWith(`..${sep}`) || (sep !== "/" && rel.startsWith("../"));
}

/**
 * Resolve a relative path against a base directory and verify
 * the result stays within the base. Resolves symlinks to prevent
 * symlink-based escapes. Returns the absolute resolved path,
 * or throws if the path escapes the base directory.
 *
 * Passing an empty string resolves to the base directory itself.
 */
export function safePath(baseDir: string, relativePath: string): string {
  const base = resolve(baseDir);
  const target = resolve(base, relativePath);

  // Lexical check first (fast path — catches ../ before touching filesystem)
  const rel = relative(base, target);
  if (isEscape(rel) || resolve(base, rel) !== target) {
    throw new PathTraversalError(relativePath);
  }

  // Symlink-aware check: resolve real paths to catch symlink escapes.
  // For write operations the target may not exist yet — walk up to the
  // nearest existing ancestor and verify *that* is inside the base.
  const realBase = existsSync(base) ? realpathSync(base) : base;
  if (existsSync(target)) {
    const realTarget = realpathSync(target);
    const realRel = relative(realBase, realTarget);
    if (isEscape(realRel)) {
      throw new PathTraversalError(relativePath);
    }
  } else {
    // Target doesn't exist yet — check the nearest existing ancestor
    let ancestor = target;
    while (ancestor !== base && !existsSync(ancestor)) {
      ancestor = resolve(ancestor, "..");
    }
    if (existsSync(ancestor)) {
      const realAncestor = realpathSync(ancestor);
      const realRel = relative(realBase, realAncestor);
      if (isEscape(realRel)) {
        throw new PathTraversalError(relativePath);
      }
    }
  }

  return target;
}

export class PathTraversalError extends Error {
  constructor(path: string) {
    super(`Path traversal denied: ${path}`);
    this.name = "PathTraversalError";
  }
}
