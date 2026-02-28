export interface LoginLimiter {
  check(): { allowed: boolean; retryAfterMs?: number };
  recordFailure(): void;
  reset(): void;
}

export interface LoginLimiterOpts {
  maxAttempts?: number;
  windowMs?: number;
  lockoutMs?: number;
}

export function createLoginLimiter(opts?: LoginLimiterOpts): LoginLimiter {
  const maxAttempts = opts?.maxAttempts ?? 5;
  const windowMs = opts?.windowMs ?? 30_000;
  const lockoutMs = opts?.lockoutMs ?? 60_000;

  const failures: number[] = [];
  let lockoutUntil = 0;

  return {
    check(): { allowed: boolean; retryAfterMs?: number } {
      const now = Date.now();

      // Check lockout
      if (lockoutUntil > now) {
        return { allowed: false, retryAfterMs: lockoutUntil - now };
      }

      // Prune old failures outside window
      while (failures.length > 0 && (failures[0] ?? 0) <= now - windowMs) {
        failures.shift();
      }

      return { allowed: true };
    },

    recordFailure(): void {
      const now = Date.now();
      failures.push(now);

      // Prune old failures outside window
      while (failures.length > 0 && (failures[0] ?? 0) <= now - windowMs) {
        failures.shift();
      }

      if (failures.length >= maxAttempts) {
        lockoutUntil = now + lockoutMs;
        failures.length = 0;
      }
    },

    reset(): void {
      failures.length = 0;
      lockoutUntil = 0;
    },
  };
}
