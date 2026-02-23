import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { loadDotEnvFiles } from "../src/env.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("loadDotEnvFiles", () => {
  const testDir = join(tmpdir(), `mecha-env-test-${Date.now()}`);
  const dir1 = join(testDir, "project");
  const dir2 = join(testDir, "cwd");

  beforeAll(() => {
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("loads vars from a single .env file", () => {
    writeFileSync(join(dir1, ".env"), "FOO=bar\nBAZ=qux\n");

    const result = loadDotEnvFiles(dir1, dir1);
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("project dir takes priority over cwd", () => {
    writeFileSync(join(dir1, ".env"), "KEY=from-project\n");
    writeFileSync(join(dir2, ".env"), "KEY=from-cwd\nEXTRA=val\n");

    const result = loadDotEnvFiles(dir1, dir2);
    expect(result["KEY"]).toBe("from-project");
    expect(result["EXTRA"]).toBe("val");
  });

  it("skips comments and blank lines", () => {
    writeFileSync(join(dir1, ".env"), "# comment\n\nVALID=yes\n  \n");

    const result = loadDotEnvFiles(dir1, dir1);
    expect(result).toEqual({ VALID: "yes" });
  });

  it("handles lines without = separator gracefully", () => {
    writeFileSync(join(dir1, ".env"), "NOEQ\nGOOD=val\n");

    const result = loadDotEnvFiles(dir1, dir1);
    expect(result).toEqual({ GOOD: "val" });
  });

  it("returns empty record when no .env files exist", () => {
    const emptyDir = join(testDir, "empty");
    mkdirSync(emptyDir, { recursive: true });

    const result = loadDotEnvFiles(emptyDir, emptyDir);
    expect(result).toEqual({});
  });

  it("deduplicates same directory", () => {
    writeFileSync(join(dir1, ".env"), "A=1\n");

    // Same path for both args
    const result = loadDotEnvFiles(dir1, dir1);
    expect(result).toEqual({ A: "1" });
  });

  it("never mutates process.env", () => {
    const envBefore = { ...process.env };
    writeFileSync(join(dir1, ".env"), "UNIQUE_TEST_VAR_XYZ=shouldnotleak\n");

    loadDotEnvFiles(dir1, dir1);

    expect(process.env["UNIQUE_TEST_VAR_XYZ"]).toBeUndefined();
    // Restore just in case
    process.env = envBefore;
  });

  it("handles values with = signs", () => {
    writeFileSync(join(dir1, ".env"), "URL=http://host:8080/path?a=b\n");

    const result = loadDotEnvFiles(dir1, dir1);
    expect(result["URL"]).toBe("http://host:8080/path?a=b");
  });
});
