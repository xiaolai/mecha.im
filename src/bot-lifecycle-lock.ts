import { mkdirSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";

const STALE_MS = 60_000; // 1 minute

/** Cross-process lifecycle lock for bot operations.
 *  Uses directory-based locking (same pattern as registry/daemon locks). */
export function withBotLifecycleLock<T>(botPath: string, fn: () => T | Promise<T>): Promise<T> {
  const lockPath = join(botPath, ".lifecycle.lock");
  const deadline = Date.now() + 30_000;

  // Acquire
  while (true) {
    try {
      mkdirSync(lockPath);
      break; // acquired
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // Check for stale lock
      try {
        const mtime = statSync(lockPath).mtimeMs;
        if (Date.now() - mtime > STALE_MS) {
          try { rmdirSync(lockPath); } catch { /* race */ }
          continue;
        }
      } catch { continue; } // lock gone, retry
      if (Date.now() >= deadline) {
        throw new Error(`Bot lifecycle lock timeout on ${botPath}`);
      }
      // Brief sync wait
      const end = Date.now() + 50;
      while (Date.now() < end) { /* spin */ }
    }
  }

  // Execute + release
  const release = () => { try { rmdirSync(lockPath); } catch { /* ok */ } };
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then((v) => { release(); return v; }, (err) => { release(); throw err; });
    }
    release();
    return Promise.resolve(result);
  } catch (err) {
    release();
    throw err;
  }
}
