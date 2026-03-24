import { openSync, closeSync, unlinkSync } from "node:fs";

/**
 * Acquire an advisory file lock using an exclusive-create lockfile.
 * Spins with a short delay until the lock is acquired or timeout.
 */
export function withFileLock<T>(lockPath: string, fn: () => T, timeoutMs = 5000): T {
  const lockFile = lockPath + ".lock";
  const start = Date.now();
  let fd: number | undefined;

  // Spin to acquire lock
  while (true) {
    try {
      fd = openSync(lockFile, "wx"); // exclusive create — fails if exists
      break;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      if (Date.now() - start > timeoutMs) {
        // Stale lock — force remove and retry once
        try { unlinkSync(lockFile); } catch { /* ok */ }
        try {
          fd = openSync(lockFile, "wx");
          break;
          /* v8 ignore start -- lock contention after stale removal */
        } catch {
          throw new Error(`Failed to acquire lock: ${lockFile}`);
        }
        /* v8 ignore stop */
      }
      // Brief spin delay (synchronous to keep it simple)
      const spinUntil = Date.now() + 10;
      while (Date.now() < spinUntil) { /* spin */ }
    }
  }

  try {
    return fn();
  } finally {
    closeSync(fd!);
    try { unlinkSync(lockFile); } catch { /* ok */ }
  }
}
