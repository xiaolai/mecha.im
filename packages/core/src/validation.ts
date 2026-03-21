import { ALL_CAPABILITIES, type Capability } from "./acl/types.js";

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
