import { describe, it, expect } from "vitest";
import { wrapFallback } from "../../src/platforms/fallback.js";
import type { SandboxProfile } from "../../src/types.js";

describe("wrapFallback", () => {
  const profile: SandboxProfile = {
    readPaths: ["/usr/bin/node"],
    writePaths: ["/mecha/alice/home"],
    allowedProcesses: ["/usr/bin/node"],
    allowNetwork: true,
  };

  it("passes through the original command unchanged", () => {
    const result = wrapFallback(profile, "/usr/bin/node", ["app.js", "--port", "7700"]);
    expect(result.bin).toBe("/usr/bin/node");
    expect(result.args).toEqual(["app.js", "--port", "7700"]);
  });

  it("works with empty args", () => {
    const result = wrapFallback(profile, "/usr/bin/node", []);
    expect(result.bin).toBe("/usr/bin/node");
    expect(result.args).toEqual([]);
  });
});
