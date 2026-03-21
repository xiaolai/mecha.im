import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimiter } from "../src/rate-limit.js";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests within limit", () => {
    const limiter = createRateLimiter({
      mecha_list_bots: { max: 3, windowMs: 60_000 },
    });
    expect(limiter.check("mecha_list_bots")).toBe(true);
    expect(limiter.check("mecha_list_bots")).toBe(true);
    expect(limiter.check("mecha_list_bots")).toBe(true);
  });

  it("blocks after exceeding limit", () => {
    const limiter = createRateLimiter({
      mecha_list_bots: { max: 3, windowMs: 60_000 },
    });
    limiter.check("mecha_list_bots");
    limiter.check("mecha_list_bots");
    limiter.check("mecha_list_bots");
    expect(limiter.check("mecha_list_bots")).toBe(false);
  });

  it("reports remaining requests", () => {
    const limiter = createRateLimiter({
      mecha_list_bots: { max: 3, windowMs: 60_000 },
    });
    expect(limiter.remaining("mecha_list_bots")).toBe(3);
    limiter.check("mecha_list_bots");
    expect(limiter.remaining("mecha_list_bots")).toBe(2);
    limiter.check("mecha_list_bots");
    limiter.check("mecha_list_bots");
    expect(limiter.remaining("mecha_list_bots")).toBe(0);
  });

  it("resets after window expires", () => {
    const limiter = createRateLimiter({
      mecha_list_bots: { max: 2, windowMs: 10_000 },
    });
    limiter.check("mecha_list_bots");
    limiter.check("mecha_list_bots");
    expect(limiter.check("mecha_list_bots")).toBe(false);

    vi.advanceTimersByTime(11_000);
    expect(limiter.check("mecha_list_bots")).toBe(true);
    expect(limiter.remaining("mecha_list_bots")).toBe(1);
  });

  it("tracks tools independently", () => {
    const limiter = createRateLimiter({
      mecha_list_bots: { max: 1, windowMs: 60_000 },
      mecha_discover: { max: 1, windowMs: 60_000 },
    });
    limiter.check("mecha_list_bots");
    expect(limiter.check("mecha_list_bots")).toBe(false);
    expect(limiter.check("mecha_discover")).toBe(true);
  });

  it("uses default limits for unconfigured tools", () => {
    const limiter = createRateLimiter();
    // Default read limit is 120/min, query is 30/min
    for (let i = 0; i < 120; i++) {
      expect(limiter.check("mecha_list_bots")).toBe(true);
    }
    expect(limiter.check("mecha_list_bots")).toBe(false);
  });

  it("uses query-specific default for mecha_query", () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 30; i++) {
      expect(limiter.check("mecha_query")).toBe(true);
    }
    expect(limiter.check("mecha_query")).toBe(false);
  });
});
