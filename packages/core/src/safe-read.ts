import { existsSync, readFileSync } from "node:fs";
import type { ZodType } from "zod";

export type SafeReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "missing" | "corrupt" | "unreadable"; detail: string };

/**
 * Safely read and parse a JSON file. Returns a discriminated union
 * instead of throwing on errors. Callers decide how to log/handle.
 *
 * @param path - Absolute file path
 * @param label - Human-readable label for error messages (e.g., "schedule config")
 * @param schema - Optional Zod schema for validation
 */
export function safeReadJson<T>(
  path: string,
  label: string,
  schema?: ZodType<T>,
): SafeReadResult<T> {
  if (!existsSync(path)) {
    return { ok: false, reason: "missing", detail: `${label}: file not found` };
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    /* v8 ignore start -- non-Error throw fallback */
    const msg = err instanceof Error ? err.message : String(err);
    /* v8 ignore stop */
    return {
      ok: false,
      reason: "unreadable",
      detail: `${label}: ${msg}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    /* v8 ignore start -- non-Error throw fallback */
    const msg = err instanceof Error ? err.message : String(err);
    /* v8 ignore stop */
    return {
      ok: false,
      reason: "corrupt",
      detail: `${label}: invalid JSON — ${msg}`,
    };
  }

  if (schema) {
    const result = schema.safeParse(parsed);
    if (!result.success) {
      return {
        ok: false,
        reason: "corrupt",
        detail: `${label}: schema validation failed`,
      };
    }
    return { ok: true, data: result.data };
  }

  return { ok: true, data: parsed as T };
}
