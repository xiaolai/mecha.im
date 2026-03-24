import { ALL_CAPABILITIES, type Capability } from "./acl/types.js";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve, relative } from "node:path";

/** Valid name pattern: lowercase alphanumeric + hyphens, 1-32 chars, no leading/trailing hyphen */
export const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Maximum length for a bot or node name */
export const NAME_MAX_LENGTH = 32;

/** Test if a string is a valid bot or node name */
export function isValidName(input: string): boolean {
  if (input.length === 0 || input.length > NAME_MAX_LENGTH) return false;
  return NAME_PATTERN.test(input);
}

/** Test if a string is a valid address: bare name ("coder"), name@node ("coder@alice"), or wildcard ("*") */
export function isValidAddress(input: string): boolean {
  if (!input) return false;
  if (input === "*") return true; // wildcard matches all (R6-002)
  const atIndex = input.indexOf("@");
  if (atIndex === -1) return isValidName(input);
  // Must have exactly one @
  if (input.indexOf("@", atIndex + 1) !== -1) return false;
  const bot = input.slice(0, atIndex);
  const node = input.slice(atIndex + 1);
  return isValidName(bot) && isValidName(node);
}

/** Valid tag pattern: lowercase alphanumeric + hyphens, 1-32 chars */
export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Maximum number of tags per bot */
export const MAX_TAGS = 20;

/** Maximum length of a single tag */
export const TAG_MAX_LENGTH = 32;

/** Validate and normalize a tags array. Returns validated tags or an error message. */
export function validateTags(tags: string[]): { ok: true; tags: string[] } | { ok: false; error: string } {
  if (tags.length > MAX_TAGS) {
    return { ok: false, error: `Too many tags (max ${MAX_TAGS})` };
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const t = tag.toLowerCase();
    if (t.length === 0 || t.length > TAG_MAX_LENGTH) {
      return { ok: false, error: `Tag "${tag}" must be 1-${TAG_MAX_LENGTH} characters` };
    }
    if (!TAG_PATTERN.test(t)) {
      return { ok: false, error: `Tag "${tag}" contains invalid characters (use lowercase alphanumeric + hyphens)` };
    }
    if (!seen.has(t)) {
      seen.add(t);
      result.push(t);
    }
  }
  return { ok: true, tags: result };
}

/** Parse a port string. Returns a valid port number (1-65535) or undefined. */
export function parsePort(raw: string): number | undefined {
  // Enforce decimal-only format to reject hex (0x1f90), scientific (1e3), etc.
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return undefined;
  return n;
}

/** Maximum number of additional directories per bot */
export const MAX_ADD_DIRS = 20;

/** Validate directories for --add-dir. Returns deduplicated resolved paths or an error. */
export function validateAddDirs(
  dirs: string[],
  mechaDir: string,
): { ok: true; dirs: string[] } | { ok: false; error: string } {
  let realMecha: string;
  try { realMecha = realpathSync(resolve(mechaDir)); } catch { realMecha = resolve(mechaDir); }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const dir of dirs) {
    if (!isAbsolute(dir)) {
      return { ok: false, error: `Path must be absolute: "${dir}"` };
    }
    // Resolve symlinks to check the real target
    let real: string;
    try {
      const stat = statSync(dir);
      if (!stat.isDirectory()) {
        return { ok: false, error: `Path is not a directory: "${dir}"` };
      }
      real = realpathSync(dir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { ok: false, error: `Path not found: "${dir}"` };
      if (code === "EACCES") return { ok: false, error: `Permission denied: "${dir}"` };
      return { ok: false, error: `Cannot access path: "${dir}"` };
    }
    // Containment check against real path (symlink-safe)
    const rel = relative(realMecha, real);
    if (!rel.startsWith("..") && !isAbsolute(rel)) {
      return { ok: false, error: `Path must not be inside mecha directory: "${dir}"` };
    }
    if (!seen.has(real)) {
      seen.add(real);
      result.push(real);
    }
  }
  // Check limit after dedup
  if (result.length > MAX_ADD_DIRS) {
    return { ok: false, error: `Too many directories (max ${MAX_ADD_DIRS})` };
  }
  return { ok: true, dirs: result };
}

/** Validate a name used as a filesystem path segment. Rejects traversal attempts. */
export function assertSafeName(name: string, label: string): void {
  if (!name || /[/\\]|^\.\.?$/.test(name) || name.includes("..")) {
    throw new Error(`Invalid ${label} name: "${name}"`);
  }
}

/** Validate a list of capability strings. Returns validated capabilities or an error message. */
export function validateCapabilities(caps: string[]): { ok: true; capabilities: Capability[] } | { ok: false; error: string } {
  const result: Capability[] = [];
  for (const c of caps) {
    if (!(ALL_CAPABILITIES as readonly string[]).includes(c)) {
      return { ok: false, error: `Invalid capability: "${c}"` };
    }
    result.push(c as Capability);
  }
  return { ok: true, capabilities: result };
}
