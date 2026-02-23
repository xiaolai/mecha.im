/** Valid name pattern: lowercase alphanumeric + hyphens, 1-32 chars, no leading/trailing hyphen */
export const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Maximum length for a CASA or node name */
export const NAME_MAX_LENGTH = 32;

/** Test if a string is a valid CASA or node name */
export function isValidName(input: string): boolean {
  if (input.length === 0 || input.length > NAME_MAX_LENGTH) return false;
  return NAME_PATTERN.test(input);
}
