import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the SPA dist directory.
 *
 * Search order:
 * 1. Relative to this file: ../../spa/dist (monorepo dev mode)
 * 2. Alongside the binary executable: <execPath>/spa (compiled binary mode)
 *
 * Returns undefined if not found (dashboard won't be served).
 */
export function resolveSpaDir(): string | undefined {
  // 1. Monorepo: packages/cli/dist/../spa/dist → packages/spa/dist
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const monorepoPath = join(thisDir, "..", "..", "spa", "dist");
  if (existsSync(join(monorepoPath, "index.html"))) {
    return monorepoPath;
  }

  // 2. Compiled binary: spa dist alongside the entry
  /* v8 ignore start -- binary-only path */
  try {
    const binPath = join(dirname(process.execPath), "spa");
    if (existsSync(join(binPath, "index.html"))) {
      return binPath;
    }
  } catch {
    // process.execPath may not be meaningful in all contexts
  }
  /* v8 ignore stop */

  return undefined;
}
