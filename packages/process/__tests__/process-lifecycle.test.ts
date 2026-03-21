import { describe, it, expect, vi, afterEach } from "vitest";
import { isPidAlive, waitForPidExit } from "../src/process-lifecycle.js";

describe("isPidAlive", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true for a living process", () => {
    // current process is always alive
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it("returns false for a non-existent PID", () => {
    expect(isPidAlive(999999999)).toBe(false);
  });

  it("returns true when process.kill throws EPERM (process exists, different user)", () => {
    const origKill = process.kill;
    process.kill = ((pid: number, signal?: number) => {
      if (signal === 0) {
        const err = new Error("EPERM") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }
      return origKill(pid, signal as any);
    }) as any;

    try {
      expect(isPidAlive(1)).toBe(true);
    } finally {
      process.kill = origKill;
    }
  });

  it("returns false when process.kill throws ESRCH", () => {
    const origKill = process.kill;
    process.kill = (() => {
      const err = new Error("ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    }) as any;

    try {
      expect(isPidAlive(1)).toBe(false);
    } finally {
      process.kill = origKill;
    }
  });
});

describe("waitForPidExit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves immediately when PID is already gone (ESRCH)", async () => {
    // Non-existent PID should resolve immediately
    await waitForPidExit(999999999, 1000);
  });

  it("resolves after timeout when PID stays alive", async () => {
    vi.useFakeTimers();
    const origKill = process.kill;
    process.kill = ((pid: number, signal?: number) => {
      if (signal === 0) return true; // always alive
      return origKill(pid, signal as any);
    }) as any;

    try {
      const promise = waitForPidExit(1, 500);
      // Advance timer past timeout + polling intervals
      await vi.advanceTimersByTimeAsync(700);
      await promise;
    } finally {
      process.kill = origKill;
      vi.useRealTimers();
    }
  });

  it("keeps polling when process.kill throws EPERM", async () => {
    vi.useFakeTimers();
    const origKill = process.kill;
    let callCount = 0;
    process.kill = ((pid: number, signal?: number) => {
      if (signal === 0) {
        callCount++;
        const err = new Error("EPERM") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }
      return origKill(pid, signal as any);
    }) as any;

    try {
      const promise = waitForPidExit(1, 500);
      // Advance past timeout
      await vi.advanceTimersByTimeAsync(700);
      await promise;
      // Should have polled multiple times due to EPERM
      expect(callCount).toBeGreaterThan(1);
    } finally {
      process.kill = origKill;
      vi.useRealTimers();
    }
  });

  it("resolves when EPERM stops after timeout", async () => {
    vi.useFakeTimers();
    const origKill = process.kill;
    const origDateNow = Date.now;
    let time = origDateNow();

    process.kill = ((pid: number, signal?: number) => {
      if (signal === 0) {
        const err = new Error("EPERM") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }
      return origKill(pid, signal as any);
    }) as any;

    // Make Date.now advance quickly to trigger timeout
    Date.now = () => {
      time += 600;
      return time;
    };

    try {
      const promise = waitForPidExit(1, 500);
      await vi.advanceTimersByTimeAsync(200);
      await promise;
    } finally {
      process.kill = origKill;
      Date.now = origDateNow;
      vi.useRealTimers();
    }
  });
});
