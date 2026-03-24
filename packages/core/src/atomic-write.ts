import { writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Write a file atomically: write to a temp file, then rename.
 * On POSIX, rename is atomic — the file is either the old or new version, never partial.
 */
export function atomicWriteSync(filePath: string, data: string, mode?: number): void {
  const tmpPath = join(dirname(filePath), `.${Date.now()}.tmp`);
  writeFileSync(tmpPath, data, { mode });
  renameSync(tmpPath, filePath);
}
