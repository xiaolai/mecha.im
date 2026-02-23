import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { MechaId } from "./types.js";

/**
 * Compute a deterministic Mecha ID from a project path.
 * ID = `mx-<slug>-<pathhash>` where slug is kebab-cased dir name
 * and pathhash is first 6 chars of base36-encoded SHA-256.
 */
export function computeMechaId(projectPath: string): MechaId {
  const canonical = resolve(projectPath);
  const slug = toSlug(canonical);
  const hash = createHash("sha256").update(canonical).digest().readBigUInt64BE(0).toString(36).slice(0, 6);
  return `mx-${slug}-${hash}` as MechaId;
}

function toSlug(canonicalPath: string): string {
  const dirName = canonicalPath.split("/").filter(Boolean).at(-1) ?? "root";
  return (
    dirName
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "root"
  );
}