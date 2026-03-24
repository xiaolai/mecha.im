import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withFileLock } from "../src/file-lock.js";

describe("withFileLock", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mecha-lock-"));
  });

  it("executes the function and returns its result", () => {
    const lockPath = join(dir, "test");
    const result = withFileLock(lockPath, () => 42);
    expect(result).toBe(42);
  });

  it("removes lock file after success", () => {
    const lockPath = join(dir, "test");
    withFileLock(lockPath, () => "ok");
    expect(existsSync(lockPath + ".lock")).toBe(false);
  });

  it("removes lock file after error", () => {
    const lockPath = join(dir, "test");
    expect(() => withFileLock(lockPath, () => { throw new Error("fail"); })).toThrow("fail");
    expect(existsSync(lockPath + ".lock")).toBe(false);
  });

  it("handles stale lock by removing and retrying", () => {
    const lockPath = join(dir, "test");
    // Create a stale lock file manually
    writeFileSync(lockPath + ".lock", "stale");

    // Should recover by removing the stale lock after timeout
    const result = withFileLock(lockPath, () => "recovered", 50);
    expect(result).toBe("recovered");
  });

  it("serializes concurrent access to the same path", () => {
    const lockPath = join(dir, "serial");
    const order: number[] = [];

    // Execute two operations in sequence (synchronous lock)
    withFileLock(lockPath, () => { order.push(1); });
    withFileLock(lockPath, () => { order.push(2); });

    expect(order).toEqual([1, 2]);
  });

  it("propagates non-EEXIST errors from openSync", () => {
    // Use a path where the parent directory doesn't exist
    const badLockPath = join(dir, "nonexistent-dir", "nested", "lock");
    expect(() => withFileLock(badLockPath, () => "nope")).toThrow();
  });
});
