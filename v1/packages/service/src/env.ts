import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Load .env files from specified directories.
 * Returns a merged record where earlier directories take priority.
 * Never mutates process.env.
 */
export function loadDotEnvFiles(projectPath: string, cwd: string): Record<string, string> {
  const result: Record<string, string> = {};
  const dirs = [...new Set([projectPath, cwd])];
  for (const dir of dirs) {
    try {
      const content = readFileSync(join(dir, ".env"), "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx);
          if (!(key in result)) result[key] = trimmed.slice(eqIdx + 1);
        }
      }
    } catch { /* no .env file, fine */ }
  }
  return result;
}
