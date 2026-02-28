import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLoginLimiter } from "../src/lib/login-limiter.js";

describe("createLoginLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under limit", () => {
    const limiter = createLoginLimiter({ maxAttempts: 5, windowMs: 30_000, lockoutMs: 60_000 });
    const result = limiter.check();
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBeUndefined();
  });

  it("allows requests after fewer than max failures", () => {
    const limiter = createLoginLimiter({ maxAttempts: 5, windowMs: 30_000, lockoutMs: 60_000 });
    limiter.recordFailure();
    limiter.recordFailure();
    limiter.recordFailure();
    const result = limiter.check();
    expect(result.allowed).toBe(true);
  });

  it("blocks after max failures reached within window", () => {
    const limiter = createLoginLimiter({ maxAttempts: 3, windowMs: 30_000, lockoutMs: 60_000 });

    limiter.recordFailure();
    limiter.recordFailure();
    limiter.recordFailure();

    const result = limiter.check();
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("allows again after lockout expires", () => {
    const limiter = createLoginLimiter({ maxAttempts: 3, windowMs: 30_000, lockoutMs: 60_000 });

    limiter.recordFailure();
    limiter.recordFailure();
    limiter.recordFailure();

    expect(limiter.check().allowed).toBe(false);

    // Advance past lockout
    vi.advanceTimersByTime(60_001);

    expect(limiter.check().allowed).toBe(true);
  });

  it("does not block if failures are outside the window", () => {
    const limiter = createLoginLimiter({ maxAttempts: 3, windowMs: 30_000, lockoutMs: 60_000 });

    limiter.recordFailure();
    limiter.recordFailure();

    // Advance past window
    vi.advanceTimersByTime(31_000);

    limiter.recordFailure();

    // Only 1 failure in current window
    expect(limiter.check().allowed).toBe(true);
  });

  it("reset clears all state", () => {
    const limiter = createLoginLimiter({ maxAttempts: 3, windowMs: 30_000, lockoutMs: 60_000 });

    limiter.recordFailure();
    limiter.recordFailure();
    limiter.recordFailure();
    expect(limiter.check().allowed).toBe(false);

    limiter.reset();
    expect(limiter.check().allowed).toBe(true);
  });

  it("uses default options when none provided", () => {
    const limiter = createLoginLimiter();
    // Default: 5 attempts
    for (let i = 0; i < 4; i++) limiter.recordFailure();
    expect(limiter.check().allowed).toBe(true);

    limiter.recordFailure();
    expect(limiter.check().allowed).toBe(false);
  });

  it("prunes stale failures during check", () => {
    const limiter = createLoginLimiter({ maxAttempts: 3, windowMs: 10_000, lockoutMs: 60_000 });

    // Record 2 failures (under limit)
    limiter.recordFailure();
    limiter.recordFailure();

    // Advance past window so those failures are stale
    vi.advanceTimersByTime(11_000);

    // check() should prune stale failures, leaving 0 in window
    const result = limiter.check();
    expect(result.allowed).toBe(true);

    // Now record 2 more — should still be allowed (stale ones pruned)
    limiter.recordFailure();
    limiter.recordFailure();
    expect(limiter.check().allowed).toBe(true);
  });

  it("returns retryAfterMs that decreases over time", () => {
    const limiter = createLoginLimiter({ maxAttempts: 1, windowMs: 30_000, lockoutMs: 10_000 });
    limiter.recordFailure();

    const first = limiter.check();
    expect(first.allowed).toBe(false);

    vi.advanceTimersByTime(5_000);

    const second = limiter.check();
    expect(second.allowed).toBe(false);
    expect(second.retryAfterMs!).toBeLessThan(first.retryAfterMs!);
  });
});
