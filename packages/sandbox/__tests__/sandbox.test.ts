import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSandbox, detectPlatform, checkAvailability } from "../src/sandbox.js";
import type { SandboxProfile } from "../src/types.js";

const profile: SandboxProfile = {
  readPaths: ["/usr/bin/node", "/mecha/discovery.json"],
  writePaths: ["/mecha/alice/home"],
  allowedProcesses: ["/usr/bin/node"],
  allowNetwork: true,
};

describe("detectPlatform", () => {
  it("returns a valid platform string", () => {
    const plat = detectPlatform();
    expect(["macos", "linux", "fallback"]).toContain(plat);
  });
});

describe("checkAvailability", () => {
  it("returns false for fallback platform", () => {
    expect(checkAvailability("fallback")).toBe(false);
  });

  it("returns a boolean for the detected platform", () => {
    const plat = detectPlatform();
    const result = checkAvailability(plat);
    expect(typeof result).toBe("boolean");
  });
});

describe("createSandbox", () => {
  it("creates sandbox with fallback platform override", () => {
    const sandbox = createSandbox("fallback");
    expect(sandbox.platform).toBe("fallback");
    expect(sandbox.isAvailable()).toBe(false);
  });

  it("describe() includes platform info for fallback", () => {
    const sandbox = createSandbox("fallback");
    expect(sandbox.describe()).toContain("fallback");
  });

  it("describe() includes platform info for macos", () => {
    const sandbox = createSandbox("macos");
    expect(sandbox.describe()).toContain("macOS");
  });

  it("describe() includes platform info for linux", () => {
    const sandbox = createSandbox("linux");
    expect(sandbox.describe()).toContain("Linux");
  });

  it("caches isAvailable result", () => {
    const sandbox = createSandbox("fallback");
    const first = sandbox.isAvailable();
    const second = sandbox.isAvailable();
    expect(first).toBe(second);
  });

  it("wrap() with fallback returns passthrough", async () => {
    const sandbox = createSandbox("fallback");
    const result = await sandbox.wrap(profile, "/usr/bin/node", ["app.js"], "/tmp/bot");
    expect(result.bin).toBe("/usr/bin/node");
    expect(result.args).toEqual(["app.js"]);
  });

  it("wrap() with macos writes .sbpl and returns sandbox-exec", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sandbox-macos-"));
    try {
      const sandbox = createSandbox("macos");
      const result = await sandbox.wrap(profile, "/usr/bin/node", ["app.js"], tempDir);
      // resolveCommand resolves to absolute path on macOS
      expect(result.bin).toMatch(/sandbox-exec$/);
      expect(result.args[0]).toBe("-f");
      expect(existsSync(join(tempDir, "sandbox.sbpl"))).toBe(true);
      const sbpl = readFileSync(join(tempDir, "sandbox.sbpl"), "utf-8");
      expect(sbpl).toContain("(version 1)");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("wrap() with linux returns bwrap command", async () => {
    const sandbox = createSandbox("linux");
    const result = await sandbox.wrap(profile, "/usr/bin/node", ["app.js"], "/tmp/bot");
    expect(result.bin).toMatch(/(?:^|\/)?bwrap$/);
    expect(result.args).toContain("--share-net");
  });
});
