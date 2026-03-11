export const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
export const NAME_MAX_LENGTH = 32;

export function isValidName(input: string): boolean {
  if (input.length === 0 || input.length > NAME_MAX_LENGTH) return false;
  return NAME_PATTERN.test(input);
}

export function assertValidName(input: string): void {
  if (!isValidName(input)) {
    throw new Error(`Invalid name: "${input}" (must be lowercase, alphanumeric, hyphens, 1-32 chars)`);
  }
}

export function parsePort(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return undefined;
  return n;
}

export function isValidUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
