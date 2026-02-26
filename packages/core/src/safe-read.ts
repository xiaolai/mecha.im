import { readFileSync } from "node:fs";
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
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { ok: false, reason: "missing", detail: `${label}: file not found` };
    }
    /* v8 ignore start -- non-ENOENT read error (permissions, etc.) */
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: "unreadable",
      detail: `${label}: ${msg}`,
    };
    /* v8 ignore stop */
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

  // Without schema, caller is responsible for validation — cast to T at call site
  return { ok: true, data: parsed as T };
}
