/** Rate limiter for login attempts with sliding window and lockout. */
export interface LoginLimiter {
  check(): { allowed: boolean; retryAfterMs?: number };
  /** Record a failed attempt. Returns true if lockout was triggered. */
  recordFailure(): boolean;
  reset(): void;
}

/** Configuration for the login rate limiter. */
export interface LoginLimiterOpts {
  maxAttempts?: number;
  windowMs?: number;
  lockoutMs?: number;
}

/** Create a login rate limiter with configurable window, max attempts, and lockout duration. */
export function createLoginLimiter(opts?: LoginLimiterOpts): LoginLimiter {
  const maxAttempts = opts?.maxAttempts ?? 5;
  const windowMs = opts?.windowMs ?? 30_000;
  const lockoutMs = opts?.lockoutMs ?? 60_000;

  const failures: number[] = [];
  let lockoutUntil = 0;

  return {
    check(): { allowed: boolean; retryAfterMs?: number } {
      const now = Date.now();

      if (lockoutUntil > now) {
        return { allowed: false, retryAfterMs: lockoutUntil - now };
      }

      /* v8 ignore start -- failures[0] is always defined when length > 0 */
      while (failures.length > 0 && (failures[0] ?? 0) <= now - windowMs) {
        failures.shift();
      }
      /* v8 ignore stop */

      return { allowed: true };
    },

    recordFailure(): boolean {
      const now = Date.now();
      failures.push(now);

      /* v8 ignore start -- failures[0] is always defined when length > 0 */
      while (failures.length > 0 && (failures[0] ?? 0) <= now - windowMs) {
        failures.shift();
      }
      /* v8 ignore stop */

      if (failures.length >= maxAttempts) {
        lockoutUntil = now + lockoutMs;
        failures.length = 0;
        return true;
      }
      return false;
    },

    reset(): void {
      failures.length = 0;
      lockoutUntil = 0;
    },
  };
}
