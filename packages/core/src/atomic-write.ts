import { writeFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Write a file atomically: write to a temp file, then rename.
 * On POSIX, rename is atomic — the file is either the old or new version, never partial.
 */
export function atomicWriteSync(filePath: string, data: string, mode?: number): void {
  const tmpPath = join(dirname(filePath), `.${randomBytes(8).toString("hex")}.tmp`);
  writeFileSync(tmpPath, data, { mode });
  try {
    renameSync(tmpPath, filePath);
  } catch (err) {
    /* v8 ignore start -- best-effort cleanup on rename failure */
    try { unlinkSync(tmpPath); } catch { /* best effort */ }
    /* v8 ignore stop */
    throw err;
  }
}
