import { describe, it, expect } from "vitest";
import { safePath, PathTraversalError } from "../src/safe-path.js";
import { resolve } from "node:path";

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
});
