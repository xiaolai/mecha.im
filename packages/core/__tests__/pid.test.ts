import { describe, it, expect } from "vitest";
import { isPidAlive } from "../src/pid.js";

describe("isPidAlive", () => {
  it("returns true for the current process", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it("returns false for a non-existent PID", () => {
    // PID 2^30 is extremely unlikely to exist
    expect(isPidAlive(2 ** 30)).toBe(false);
  });
});
