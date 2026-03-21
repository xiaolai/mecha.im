import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { safePath, PathTraversalError } from "../src/safe-path.js";
import { resolve, join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("safePath", () => {
  const base = "/home/bot";

  it("resolves a simple relative path", () => {
    expect(safePath(base, "docs/readme.md")).toBe(resolve(base, "docs/readme.md"));
  });

  it("resolves a nested path", () => {
    expect(safePath(base, "a/b/c.txt")).toBe(resolve(base, "a/b/c.txt"));
  });

  it("rejects path traversal with ../", () => {
    expect(() => safePath(base, "../etc/passwd")).toThrow(PathTraversalError);
  });

  it("rejects path traversal with embedded ../", () => {
    expect(() => safePath(base, "docs/../../etc/passwd")).toThrow(PathTraversalError);
  });

  it("rejects absolute paths outside base", () => {
    expect(() => safePath(base, "/etc/passwd")).toThrow(PathTraversalError);
  });

  it("allows path that resolves to base itself", () => {
    expect(safePath(base, ".")).toBe(resolve(base));
  });

  it("allows path with redundant slashes", () => {
    expect(safePath(base, "docs//readme.md")).toBe(resolve(base, "docs/readme.md"));
  });

  it("allows names starting with .. that are not traversal (e.g. ..notes)", () => {
    expect(safePath(base, "..notes")).toBe(resolve(base, "..notes"));
  });

  it("rejects bare .. (parent escape)", () => {
    expect(() => safePath(base, "..")).toThrow(PathTraversalError);
  });
});

describe("safePath symlink checks", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "safepath-"));
    mkdirSync(join(baseDir, "docs"));
    writeFileSync(join(baseDir, "docs", "readme.md"), "hello");
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("allows real files inside base", () => {
    const result = safePath(baseDir, "docs/readme.md");
    expect(result).toBe(join(baseDir, "docs", "readme.md"));
  });

  it("rejects symlink that escapes base", () => {
    symlinkSync("/tmp", join(baseDir, "escape"));
    expect(() => safePath(baseDir, "escape")).toThrow(PathTraversalError);
  });

  it("rejects symlink in ancestor path that escapes base", () => {
    symlinkSync("/tmp", join(baseDir, "linked-dir"));
    expect(() => safePath(baseDir, "linked-dir/nonexistent.md")).toThrow(PathTraversalError);
  });

  it("allows non-existent file under real ancestor inside base", () => {
    const result = safePath(baseDir, "docs/new-file.md");
    expect(result).toBe(join(baseDir, "docs", "new-file.md"));
  });
});
