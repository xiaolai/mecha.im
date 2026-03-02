import { describe, it, expect, vi, afterEach } from "vitest";
import { createLoginLimiter } from "../src/login-limiter.js";

describe("createLoginLimiter", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("allows attempts by default", () => {
    const limiter = createLoginLimiter();
    expect(limiter.check().allowed).toBe(true);
  });

  it("locks out after max attempts", () => {
    const limiter = createLoginLimiter({ maxAttempts: 3, windowMs: 60_000, lockoutMs: 10_000 });
    limiter.recordFailure();
    limiter.recordFailure();
    limiter.recordFailure();
    const result = limiter.check();
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after successful login", () => {
    const limiter = createLoginLimiter({ maxAttempts: 3 });
    limiter.recordFailure();
    limiter.recordFailure();
    limiter.reset();
    expect(limiter.check().allowed).toBe(true);
  });

  it("allows again after lockout expires", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    const limiter = createLoginLimiter({ maxAttempts: 2, windowMs: 60_000, lockoutMs: 1_000 });
    limiter.recordFailure();
    limiter.recordFailure();

    // Still locked
    expect(limiter.check().allowed).toBe(false);

    // Advance past lockout
    vi.spyOn(Date, "now").mockReturnValue(now + 1_500);
    expect(limiter.check().allowed).toBe(true);
  });
});
