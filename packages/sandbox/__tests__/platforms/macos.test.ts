import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
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
  const sbpl = generateSbpl(profile);

  it("generates valid SBPL with deny default and system permissions", () => {
    expect(sbpl).toContain("(version 1)");
    expect(sbpl).toContain("(deny default)");
    expect(sbpl).toContain("(allow sysctl-read)");
    expect(sbpl).toContain("(allow mach-lookup)");
    expect(sbpl).toContain("(allow process-fork)");
    expect(sbpl).toContain("(allow signal)");
    // Unrestricted file-read* — Bun compiled binary requires access to
    // paths that can't be enumerated (kernel pseudo-filesystems, Apple-internal)
    expect(sbpl).toContain("(allow file-read*)");
    // /dev/null write access — Bun's child_process.spawn opens /dev/null for
    // stdio fds set to "ignore"; without this, posix_spawn fails with EPERM (R7-001)
    expect(sbpl).toContain('(allow file-write* (literal "/dev/null"))');
  });

  it("includes write path rules", () => {
    expect(sbpl).toContain('(allow file-write* (subpath "/mecha/alice/home"))');
    expect(sbpl).toContain('(allow file-write* (subpath "/mecha/alice/logs"))');
  });

  it("includes network access when allowed", () => {
    expect(sbpl).toContain("(allow network*)");
  });

  it("omits network access when not allowed", () => {
    const sbpl = generateSbpl({ ...profile, allowNetwork: false });
    expect(sbpl).not.toContain("(allow network*)");
  });

  it("includes allowed process rules", () => {
    expect(sbpl).toContain('(allow process-exec (literal "/usr/local/bin/node"))');
  });

  it("does not include global process-exec", () => {
    // Should only have per-process literal rules, not global (allow process-exec)
    const execLines = sbpl.split("\n").filter(l => l.includes("process-exec"));
    expect(execLines).toHaveLength(profile.allowedProcesses.length);
    for (const line of execLines) {
      expect(line).toContain("(literal");
    }
  });

  it("escapes quotes and backslashes in paths", () => {
    const evil: SandboxProfile = {
      readPaths: ['/path/with"quote'],
      writePaths: ["/path/with\\backslash", '/path/with"quote'],
      allowedProcesses: ['/bin/"evil"),'],
      allowNetwork: false,
    };
    const sbpl = generateSbpl(evil);
    // readPaths are covered by unrestricted file-read* — only writePaths and processes escape
    expect(sbpl).toContain('(allow file-write* (subpath "/path/with\\"quote"))');
    expect(sbpl).toContain('(allow file-write* (subpath "/path/with\\\\backslash"))');
    expect(sbpl).toContain('(allow process-exec (literal "/bin/\\"evil\\"),"))');
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

  it("rejects control characters", () => {
    expect(() => escapeSbpl("/path/with\nnewline")).toThrow("control characters");
    expect(() => escapeSbpl("/path/with\ttab")).toThrow("control characters");
    expect(() => escapeSbpl("/path/with\x00null")).toThrow("control characters");
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
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
