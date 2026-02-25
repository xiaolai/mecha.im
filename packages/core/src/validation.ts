/** Valid name pattern: lowercase alphanumeric + hyphens, 1-32 chars, no leading/trailing hyphen */
export const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Maximum length for a CASA or node name */
export const NAME_MAX_LENGTH = 32;

/** Test if a string is a valid CASA or node name */
export function isValidName(input: string): boolean {
  if (input.length === 0 || input.length > NAME_MAX_LENGTH) return false;
  return NAME_PATTERN.test(input);
}

/** Valid tag pattern: lowercase alphanumeric + hyphens, 1-32 chars */
export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Maximum number of tags per CASA */
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
