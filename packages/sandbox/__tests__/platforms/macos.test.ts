import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateSbpl, escapeSbpl, wrapMacos, writeProfileMacos } from "../../src/platforms/macos.js";
import type { SandboxProfile } from "../../src/types.js";

describe("generateSbpl", () => {
  const profile: SandboxProfile = {
    readPaths: ["/usr/local/bin/node", "/mecha/discovery.json"],
    writePaths: ["/mecha/alice/home", "/mecha/alice/logs"],
    allowedProcesses: ["/usr/local/bin/node"],
    allowNetwork: true,
  };

  it("generates valid SBPL with deny default", () => {
    const sbpl = generateSbpl(profile);
    expect(sbpl).toContain("(version 1)");
    expect(sbpl).toContain("(deny default)");
  });

  it("includes read path rules", () => {
    const sbpl = generateSbpl(profile);
    expect(sbpl).toContain('(allow file-read* (subpath "/usr/local/bin/node"))');
    expect(sbpl).toContain('(allow file-read* (subpath "/mecha/discovery.json"))');
  });

  it("includes write path rules with both read and write", () => {
    const sbpl = generateSbpl(profile);
    expect(sbpl).toContain('(allow file-read* (subpath "/mecha/alice/home"))');
    expect(sbpl).toContain('(allow file-write* (subpath "/mecha/alice/home"))');
  });

  it("includes network access when allowed", () => {
    const sbpl = generateSbpl(profile);
    expect(sbpl).toContain("(allow network*)");
  });

  it("omits network access when not allowed", () => {
    const sbpl = generateSbpl({ ...profile, allowNetwork: false });
    expect(sbpl).not.toContain("(allow network*)");
  });

  it("includes allowed process rules", () => {
    const sbpl = generateSbpl(profile);
    expect(sbpl).toContain('(allow process-exec (literal "/usr/local/bin/node"))');
  });

  it("does not include global process-exec", () => {
    const sbpl = generateSbpl(profile);
    // Should only have per-process literal rules, not global (allow process-exec)
    const execLines = sbpl.split("\n").filter(l => l.includes("process-exec"));
    for (const line of execLines) {
      expect(line).toContain("(literal");
    }
  });

  it("escapes quotes and backslashes in paths", () => {
    const evil: SandboxProfile = {
      readPaths: ['/path/with"quote'],
      writePaths: ["/path/with\\backslash"],
      allowedProcesses: ['/bin/"evil"),'],
      allowNetwork: false,
    };
    const sbpl = generateSbpl(evil);
    expect(sbpl).toContain('(subpath "/path/with\\"quote")');
    expect(sbpl).toContain('(subpath "/path/with\\\\backslash")');
    expect(sbpl).toContain('(literal "/bin/\\"evil\\"),")');
  });
});

describe("escapeSbpl", () => {
  it("escapes double quotes", () => {
    expect(escapeSbpl('a"b')).toBe('a\\"b');
  });

  it("escapes backslashes", () => {
    expect(escapeSbpl("a\\b")).toBe("a\\\\b");
  });

  it("passes through safe strings unchanged", () => {
    expect(escapeSbpl("/usr/bin/node")).toBe("/usr/bin/node");
  });
});

describe("wrapMacos", () => {
  it("returns sandbox-exec command with profile path", () => {
    const result = wrapMacos("/tmp/sandbox.sbpl", "/usr/local/bin/node", ["app.js"]);
    expect(result.bin).toBe("sandbox-exec");
    expect(result.args).toEqual(["-f", "/tmp/sandbox.sbpl", "--", "/usr/local/bin/node", "app.js"]);
  });

  it("works with empty runtime args", () => {
    const result = wrapMacos("/tmp/sandbox.sbpl", "/usr/bin/node", []);
    expect(result.args).toEqual(["-f", "/tmp/sandbox.sbpl", "--", "/usr/bin/node"]);
  });
});

describe("writeProfileMacos", () => {
  let tempDir: string;
  afterEach(() => { if (tempDir) rmSync(tempDir, { recursive: true, force: true }); });

  it("writes .sbpl file and returns path", () => {
    tempDir = mkdtempSync(join(tmpdir(), "sbpl-test-"));
    const sbpl = "(version 1)\n(deny default)\n";
    const path = writeProfileMacos(tempDir, sbpl);

    expect(path).toBe(join(tempDir, "sandbox.sbpl"));
    expect(readFileSync(path, "utf-8")).toBe(sbpl);
  });
});
