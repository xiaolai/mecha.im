/**
 * Simple template rendering: replaces {{expr}} with values from context.
 * Supports dot notation: {{step.output.field}}
 * Supports array indexing: {{step.output[0].field}}
 */
export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{(.+?)\}\}/g, (_match, expr: string) => {
    const value = resolveExpression(expr.trim(), context);
    if (value === undefined || value === null) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}

/** Resolve a dotted/bracketed expression against a context object. */
export function resolveExpression(expr: string, context: Record<string, unknown>): unknown {
  // Split on dots and brackets: "a.b[0].c" → ["a", "b", "0", "c"]
  const parts = expr.split(/\.|\[|\]/).filter(Boolean);
  let current: unknown = context;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Evaluate a simple condition expression against context.
 * Supports: "!step.field" (negation), "step.field" (truthy check).
 */
export function evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
  const trimmed = condition.trim();
  if (trimmed.startsWith("!")) {
    const value = resolveExpression(trimmed.slice(1).trim(), context);
    return !value;
  }
  const value = resolveExpression(trimmed, context);
  return !!value;
}
