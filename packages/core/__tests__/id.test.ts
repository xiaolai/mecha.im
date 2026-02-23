import { describe, it, expect } from "vitest";
import { computeMechaId } from "../src/id.js";

describe("computeMechaId", () => {
  it("produces an ID in the format mx-<slug>-<hash>", () => {
    const id = computeMechaId("/home/user/projects/foo/bar");
    expect(id).toMatch(/^mx-[a-z0-9-]+-[a-z0-9]{6}$/);
  });

  it("uses the final directory name as slug", () => {
    const id = computeMechaId("/some/path/my-project");
    expect(id).toMatch(/^mx-my-project-/);
  });

  it("converts camelCase directory names to kebab-case", () => {
    const id = computeMechaId("/path/to/myProject");
    expect(id).toMatch(/^mx-my-project-/);
  });

  it("is deterministic — same path always produces same ID", () => {
    const path = "/Users/test/projects/alpha";
    const id1 = computeMechaId(path);
    const id2 = computeMechaId(path);
    expect(id1).toBe(id2);
  });

  it("produces different IDs for different paths with same dir name", () => {
    const id1 = computeMechaId("/a/project");
    const id2 = computeMechaId("/b/project");
    // Same slug but different hash
    expect(id1).not.toBe(id2);
    expect(id1.startsWith("mx-project-")).toBe(true);
    expect(id2.startsWith("mx-project-")).toBe(true);
  });

  it("resolves relative paths to absolute", () => {
    // Both should resolve to the same absolute path
    const abs = computeMechaId(process.cwd() + "/test-dir");
    const rel = computeMechaId("./test-dir");
    expect(abs).toBe(rel);
  });

  it("sanitizes special characters in directory names", () => {
    const id = computeMechaId("/path/my.project_v2");
    expect(id).toMatch(/^mx-my-project-v2-/);
  });

  it("uses 'root' slug for the root path", () => {
    const id = computeMechaId("/");
    expect(id).toMatch(/^mx-root-/);
  });

  it("uses 'root' slug when dir name is all special characters", () => {
    const id = computeMechaId("/path/to/...");
    expect(id).toMatch(/^mx-root-/);
  });

  it("handles paths with trailing slashes", () => {
    const id1 = computeMechaId("/path/to/project");
    const id2 = computeMechaId("/path/to/project/");
    // resolve() strips trailing slash, so these should be equal
    expect(id1).toBe(id2);
  });
});
