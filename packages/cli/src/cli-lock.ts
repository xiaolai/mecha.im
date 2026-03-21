import { openSync, readFileSync, writeFileSync, closeSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isPidAlive } from "@mecha/core";

const LOCK_FILE = "cli.lock";

/** Information stored in the CLI lock file. */
export interface CliLockInfo {
  pid: number;
  startedAt: string;
}

/** Read the CLI lock file. Returns null if missing or corrupt. */
export function readCliLock(mechaDir: string): CliLockInfo | null {
  try {
    const raw = readFileSync(join(mechaDir, LOCK_FILE), "utf-8");
    const info = JSON.parse(raw) as CliLockInfo;
    if (!Number.isSafeInteger(info.pid) || info.pid <= 0 || typeof info.startedAt !== "string") {
      return null;
    }
    return info;
  } catch (err) {
    /* v8 ignore start -- only ENOENT and JSON parse errors expected */
    if ((err as NodeJS.ErrnoException).code !== "ENOENT" && !(err instanceof SyntaxError)) {
      console.error("[mecha] Failed to read cli.lock:", (err as Error).message);
    }
    /* v8 ignore stop */
    return null;
  }
}

/**
 * Acquire the CLI singleton lock using O_CREAT|O_EXCL for atomicity.
 * Returns true if lock acquired, false if another CLI instance is running.
 * Cleans stale locks from dead processes automatically.
 */
export function acquireCliLock(mechaDir: string): boolean {
  mkdirSync(mechaDir, { recursive: true });
  const target = join(mechaDir, LOCK_FILE);

  // Try exclusive create first — if it succeeds, no race is possible
  try {
    const fd = openSync(target, "wx", 0o600);
    const info: CliLockInfo = { pid: process.pid, startedAt: new Date().toISOString() };
    writeFileSync(fd, JSON.stringify(info, null, 2) + "\n");
    closeSync(fd);
    return true;
  } catch (err) {
    // EEXIST means lock file exists — check if the holder is alive
    // Other errors (EACCES, EROFS, etc.) should surface, not be treated as contention
    /* v8 ignore start -- non-EEXIST errors: requires permission/disk issues */
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      throw err;
    }
    /* v8 ignore stop */
  }

  const existing = readCliLock(mechaDir);
  if (existing && isPidAlive(existing.pid)) {
    return false;
  }

  // Stale lock — delete and retry with O_CREAT|O_EXCL for atomicity
  try { unlinkSync(target); } catch { /* ENOENT is fine — another process may have cleaned it */ }
  try {
    const fd = openSync(target, "wx", 0o600);
    const info: CliLockInfo = { pid: process.pid, startedAt: new Date().toISOString() };
    writeFileSync(fd, JSON.stringify(info, null, 2) + "\n");
    closeSync(fd);
    return true;
  /* v8 ignore start -- race condition: another process created the lock between our unlink and open */
  } catch {
    return false;
  }
  /* v8 ignore stop */
}

/**
 * Check if the current argv requires the singleton lock.
 * Uses the MUTATING_COMMANDS set from program.ts (single source of truth).
 */
export { needsLock } from "./program.js";

/** Release the CLI singleton lock. Only removes if the lock belongs to this process. */
export function releaseCliLock(mechaDir: string): void {
  const info = readCliLock(mechaDir);
  if (info && info.pid === process.pid) {
    try {
      unlinkSync(join(mechaDir, LOCK_FILE));
    } catch {
      /* v8 ignore start -- best-effort cleanup, ENOENT race is harmless */
    }
    /* v8 ignore stop */
  }
}
