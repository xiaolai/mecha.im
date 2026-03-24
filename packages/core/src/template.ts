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

/** Comparator operators for condition expressions. */
const COMPARATORS = [">=", "<=", "!=", "==", ">", "<"] as const;
type Comparator = (typeof COMPARATORS)[number];

/** Parse a literal value from a condition expression. */
function parseLiteral(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  // Quoted string: 'value' or "value"
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  // Number
  const num = Number(trimmed);
  if (!Number.isNaN(num)) return num;
  /* v8 ignore start -- fallback for unquoted strings */
  return trimmed;
  /* v8 ignore stop */
}

/** Compare two values with the given operator. */
function compare(left: unknown, op: Comparator, right: unknown): boolean {
  switch (op) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case ">":
      return (left as number) > (right as number);
    case "<":
      return (left as number) < (right as number);
    case ">=":
      return (left as number) >= (right as number);
    case "<=":
      return (left as number) <= (right as number);
  }
}

/**
 * Evaluate a condition expression against context.
 * Supports: truthy, negation, and comparisons (==, !=, >, <, >=, <=).
 */
export function evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
  const trimmed = condition.trim();

  // Negation: "!path"
  if (trimmed.startsWith("!")) {
    const value = resolveExpression(trimmed.slice(1).trim(), context);
    return !value;
  }

  // Try comparator match: "path op literal"
  for (const op of COMPARATORS) {
    const idx = trimmed.indexOf(` ${op} `);
    if (idx !== -1) {
      const leftExpr = trimmed.slice(0, idx).trim();
      const rightRaw = trimmed.slice(idx + op.length + 2).trim();
      const left = resolveExpression(leftExpr, context);
      const right = parseLiteral(rightRaw);
      return compare(left, op, right);
    }
  }

  // Fallback: truthy check
  const value = resolveExpression(trimmed, context);
  return !!value;
}
