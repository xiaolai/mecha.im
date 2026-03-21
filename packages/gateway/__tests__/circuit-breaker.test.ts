import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCircuitBreaker, CircuitOpenError } from "../src/circuit-breaker.js";

describe("createCircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in closed state", () => {
    const cb = createCircuitBreaker();
    expect(cb.state).toBe("closed");
  });

  it("executes functions normally when closed", async () => {
    const cb = createCircuitBreaker();
    const result = await cb.execute(async () => 42);
    expect(result).toBe(42);
    expect(cb.state).toBe("closed");
  });

  it("trips to open after maxFailures consecutive failures", async () => {
    const cb = createCircuitBreaker({ maxFailures: 3 });
    const fail = () => cb.execute(async () => { throw new Error("fail"); });

    await expect(fail()).rejects.toThrow("fail");
    await expect(fail()).rejects.toThrow("fail");
    expect(cb.state).toBe("closed");

    await expect(fail()).rejects.toThrow("fail");
    expect(cb.state).toBe("open");
  });

  it("rejects calls when open", async () => {
    const cb = createCircuitBreaker({ maxFailures: 1 });
    await expect(
      cb.execute(async () => { throw new Error("fail"); }),
    ).rejects.toThrow("fail");

    expect(cb.state).toBe("open");
    await expect(
      cb.execute(async () => "should not run"),
    ).rejects.toThrow(CircuitOpenError);
  });

  it("transitions to half-open after resetTimeoutMs", async () => {
    const cb = createCircuitBreaker({ maxFailures: 1, resetTimeoutMs: 5000 });

    await expect(
      cb.execute(async () => { throw new Error("fail"); }),
    ).rejects.toThrow("fail");
    expect(cb.state).toBe("open");

    vi.advanceTimersByTime(5000);
    expect(cb.state).toBe("half-open");
  });

  it("closes after a successful call in half-open state", async () => {
    const cb = createCircuitBreaker({ maxFailures: 1, resetTimeoutMs: 1000 });

    await expect(
      cb.execute(async () => { throw new Error("fail"); }),
    ).rejects.toThrow("fail");
    expect(cb.state).toBe("open");

    vi.advanceTimersByTime(1000);
    expect(cb.state).toBe("half-open");

    const result = await cb.execute(async () => "recovered");
    expect(result).toBe("recovered");
    expect(cb.state).toBe("closed");
  });

  it("re-opens if the half-open test call fails", async () => {
    const cb = createCircuitBreaker({ maxFailures: 1, resetTimeoutMs: 1000 });

    await expect(
      cb.execute(async () => { throw new Error("fail"); }),
    ).rejects.toThrow("fail");

    vi.advanceTimersByTime(1000);
    expect(cb.state).toBe("half-open");

    await expect(
      cb.execute(async () => { throw new Error("still failing"); }),
    ).rejects.toThrow("still failing");
    expect(cb.state).toBe("open");
  });

  it("resets failure count on success when closed", async () => {
    const cb = createCircuitBreaker({ maxFailures: 3 });

    // Accumulate 2 failures
    await expect(cb.execute(async () => { throw new Error("f1"); })).rejects.toThrow();
    await expect(cb.execute(async () => { throw new Error("f2"); })).rejects.toThrow();

    // One success resets the count
    await cb.execute(async () => "ok");
    expect(cb.state).toBe("closed");

    // Need 3 more failures to trip, not 1
    await expect(cb.execute(async () => { throw new Error("f3"); })).rejects.toThrow();
    await expect(cb.execute(async () => { throw new Error("f4"); })).rejects.toThrow();
    expect(cb.state).toBe("closed");
  });

  it("reset() returns circuit to closed state", async () => {
    const cb = createCircuitBreaker({ maxFailures: 1 });

    await expect(
      cb.execute(async () => { throw new Error("fail"); }),
    ).rejects.toThrow("fail");
    expect(cb.state).toBe("open");

    cb.reset();
    expect(cb.state).toBe("closed");

    const result = await cb.execute(async () => "works");
    expect(result).toBe("works");
  });

  it("uses default opts (maxFailures=5, resetTimeoutMs=60000)", async () => {
    const cb = createCircuitBreaker();

    for (let i = 0; i < 4; i++) {
      await expect(cb.execute(async () => { throw new Error("f"); })).rejects.toThrow();
    }
    expect(cb.state).toBe("closed");

    await expect(cb.execute(async () => { throw new Error("f"); })).rejects.toThrow();
    expect(cb.state).toBe("open");

    // Not half-open until 60s passes
    vi.advanceTimersByTime(59_999);
    expect(cb.state).toBe("open");

    vi.advanceTimersByTime(1);
    expect(cb.state).toBe("half-open");
  });
});
