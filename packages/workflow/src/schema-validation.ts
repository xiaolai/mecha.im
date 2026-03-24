/** Validate step output against a simple schema. Returns array of error strings. */
export function validateOutput(output: unknown, schema: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const schemaType = schema.type as string | undefined;

  if (schemaType === "object") {
    if (typeof output !== "object" || output === null) {
      errors.push(`Expected object, got ${typeof output}`);
      return errors;
    }
    const obj = output as Record<string, unknown>;
    const required = (schema.required as string[]) ?? [];
    for (const key of required) {
      if (!(key in obj)) {
        errors.push(`Missing required field: ${key}`);
      }
    }
    const properties = (schema.properties as Record<string, { type?: string }>) ?? {};
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in obj && propSchema.type) {
        const actual = typeof obj[key];
        if (actual !== propSchema.type) {
          errors.push(`Field "${key}": expected ${propSchema.type}, got ${actual}`);
        }
      }
    }
  }

  return errors;
}
