import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the SPA dist directory.
 *
 * Search order:
 * 1. Relative to this file: ../../spa/dist (monorepo dev mode)
 * 2. Alongside this file: ./spa/ (npm-installed, publish build copies SPA here)
 *
 * Returns undefined if not found (dashboard won't be served).
 */
export async function resolveSpaDir(): Promise<string | undefined> {
  const thisDir = dirname(fileURLToPath(import.meta.url));

  // 1. Monorepo: packages/cli/dist/../../spa/dist → packages/spa/dist
  const monorepoPath = join(thisDir, "..", "..", "spa", "dist");
  if (existsSync(join(monorepoPath, "index.html"))) {
    return monorepoPath;
  }

  /* v8 ignore start -- npm-installed path only exists in published package */
  // 2. npm-installed: dist/spa/ (copied during publish build)
  const installedPath = join(thisDir, "spa");
  if (existsSync(join(installedPath, "index.html"))) {
    return installedPath;
  }

  return undefined;
  /* v8 ignore stop */
}
