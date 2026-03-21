import { MechaError } from "./errors.js";

/** Extract a user-facing error message */
export function toUserMessage(err: unknown): string {
  if (err instanceof MechaError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Extract a safe error message (strips stack traces and internal details) */
export function toSafeMessage(err: unknown): string {
  if (err instanceof MechaError) return err.message;
  if (err instanceof Error) return "Internal error";
  return "Unknown error";
}
