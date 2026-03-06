import { describe, it, expect } from "vitest";
import { resolveClaudeRuntime } from "../src/claude-runtime.js";

describe("resolveClaudeRuntime", () => {
  it("returns a ClaudeRuntimeInfo object with expected shape", () => {
    const info = resolveClaudeRuntime();
    expect(info).toHaveProperty("binPath");
    expect(info).toHaveProperty("version");
    expect(info).toHaveProperty("resolvedFrom");
    expect(typeof info.resolvedFrom).toBe("string");
  });

  it("finds claude binary on this machine", () => {
    const info = resolveClaudeRuntime();
    // CI machines may not have claude installed — skip assertion if not found
    if (info.binPath) {
      expect(info.binPath).toMatch(/claude$/);
      expect(info.version).toMatch(/^\d+\.\d+/);
      expect(info.resolvedFrom).not.toBe("not-found");
    } else {
      expect(info.resolvedFrom).toBe("not-found");
      expect(info.version).toBeNull();
    }
  });
});
