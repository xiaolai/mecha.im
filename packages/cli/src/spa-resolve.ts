import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

/**
 * Resolve the SPA dist directory.
 *
 * Search order:
 * 1. Relative to this file: ../../spa/dist (monorepo dev mode)
 * 2. Alongside the binary executable: <execPath>/spa (compiled binary with spa/ dir)
 * 3. Embedded SPA archive: extract to ~/.mecha/.spa-cache/<version>/ (compiled single binary)
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

  // 3. Embedded SPA: extract compressed archive to cache dir
  /* v8 ignore start -- embedded SPA only exists in compiled binary */
  try {
    return extractEmbeddedSpa();
  } catch (err) {
    process.stderr.write(`[mecha] SPA extraction failed: ${err instanceof Error ? err.message : "unknown"}\n`);
  }
  /* v8 ignore stop */

  return undefined;
}

/* v8 ignore start -- embedded SPA extraction only runs in compiled binary */

/** Extract the embedded SPA archive to a versioned cache directory. */
function extractEmbeddedSpa(): string | undefined {
  let mod: { SPA_ARCHIVE_B64: string; SPA_VERSION: string };
  try {
    // Use createRequire for ESM compatibility — dynamic import won't work with generated file
    const esmRequire = createRequire(import.meta.url);
    mod = esmRequire("./spa-embedded.generated.js");
  } catch {
    return undefined;
  }

  const { SPA_ARCHIVE_B64, SPA_VERSION } = mod;
  if (!SPA_ARCHIVE_B64 || !SPA_VERSION) return undefined;

  // Cache dir: ~/.mecha/.spa-cache/<version>/
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  const cacheDir = join(homeDir, ".mecha", ".spa-cache", SPA_VERSION);

  // Already extracted — use cached version
  if (existsSync(join(cacheDir, "index.html"))) {
    return cacheDir;
  }

  // Extract tar.gz from base64
  mkdirSync(cacheDir, { recursive: true });
  const archiveBuffer = Buffer.from(SPA_ARCHIVE_B64, "base64");

  // Write archive to unique temp file (PID avoids race between concurrent processes), extract, clean up
  const tmpTar = join(cacheDir, `.spa-${process.pid}.tar.gz`);
  writeFileSync(tmpTar, archiveBuffer, { mode: 0o600 });
  try {
    execFileSync("tar", ["-xzf", tmpTar, "-C", cacheDir]);
  } finally {
    try { unlinkSync(tmpTar); } catch { /* best-effort cleanup */ }
  }

  if (existsSync(join(cacheDir, "index.html"))) {
    return cacheDir;
  }

  return undefined;
}

/* v8 ignore stop */
