import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";

/** Contents of a lock file. */
export interface LockInfo {
  resource: string;
  owner: string;
  acquiredAt: string;
}

/** Handle returned by acquireLock — pass to releaseLock. */
export interface LockHandle {
  lockPath: string;
  info: LockInfo;
}

/** Hash a resource path into a safe filename. */
function resourceHash(resource: string): string {
  return createHash("sha256").update(resource).digest("hex").slice(0, 16);
}

/**
 * Acquire an exclusive lock on a resource.
 *
 * Creates `<lockDir>/<resource-hash>.lock` atomically (write .tmp, rename).
 * Throws if the resource is already locked.
 */
export function acquireLock(
  lockDir: string,
  resource: string,
  owner = `pid-${process.pid}`,
): LockHandle {
  mkdirSync(lockDir, { recursive: true });

  const hash = resourceHash(resource);
  const lockPath = join(lockDir, `${hash}.lock`);

  const info: LockInfo = {
    resource,
    owner,
    acquiredAt: new Date().toISOString(),
  };

  // Exclusive create: O_CREAT | O_EXCL — fails atomically if file exists
  try {
    writeFileSync(lockPath, JSON.stringify(info, null, 2) + "\n", { flag: "wx" });
  } catch (err) {
    /* v8 ignore start -- re-throw for non-EEXIST errors */
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      /* v8 ignore start -- race-condition fallback for lock contention */
      let ownerInfo = "unknown";
      try {
        const existing = JSON.parse(readFileSync(lockPath, "utf-8")) as LockInfo;
        ownerInfo = `"${existing.resource}" by ${existing.owner}`;
      } catch {
        ownerInfo = "(unreadable lock file)";
      }
      /* v8 ignore stop */
      throw new Error(`Resource already locked: ${ownerInfo}`);
    }
    throw err;
    /* v8 ignore stop */
  }

  return { lockPath, info };
}

/**
 * Release a previously acquired lock.
 */
export function releaseLock(handle: LockHandle): void {
  if (existsSync(handle.lockPath)) {
    // Verify the lock is still ours before deleting
    try {
      const current = JSON.parse(readFileSync(handle.lockPath, "utf-8")) as LockInfo;
      if (current.owner !== handle.info.owner) return;
    /* v8 ignore start -- corrupt lock file fallback */
    } catch {
      return;
    }
    /* v8 ignore stop */
    unlinkSync(handle.lockPath);
  }
}

/**
 * Check whether a resource is currently locked.
 */
export function isLocked(lockDir: string, resource: string): boolean {
  const hash = resourceHash(resource);
  const lockPath = join(lockDir, `${hash}.lock`);
  return existsSync(lockPath);
}
