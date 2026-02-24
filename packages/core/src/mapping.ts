import { MechaError } from "./errors.js";

/** Extract HTTP status code from an error (defaults to 500) */
export function toHttpStatus(err: unknown): number {
  if (err instanceof MechaError) return err.statusCode;
  return 500;
}

/** Extract CLI exit code from an error (defaults to 1) */
export function toExitCode(err: unknown): number {
  if (err instanceof MechaError) return err.exitCode;
  return 1;
}

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
