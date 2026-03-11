import { readFileSync } from "node:fs";
import type { ZodType } from "zod";

export type SafeReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "missing" | "corrupt" | "schema" | "unreadable"; detail: string };

export function safeReadJson<T>(
  path: string,
  label: string,
  schema: ZodType<T>,
): SafeReadResult<T>;
export function safeReadJson(
  path: string,
  label: string,
): SafeReadResult<unknown>;
export function safeReadJson<T>(
  path: string,
  label: string,
  schema?: ZodType<T>,
): SafeReadResult<T> | SafeReadResult<unknown> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { ok: false, reason: "missing", detail: `${label}: file not found` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "unreadable", detail: `${label}: ${msg}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "corrupt", detail: `${label}: invalid JSON — ${msg}` };
  }

  if (schema) {
    const result = schema.safeParse(parsed);
    if (!result.success) {
      return { ok: false, reason: "schema", detail: `${label}: schema validation failed` };
    }
    return { ok: true, data: result.data };
  }

  // Without schema, return as unknown (caller must validate)
  return { ok: true, data: parsed };
}
