import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { atomicWriteSync } from "../src/atomic-write.js";

let tmpDir: string;
afterEach(() => { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); });

describe("atomicWriteSync", () => {
  it("writes file content", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "atomic-"));
    const path = join(tmpDir, "test.json");
    atomicWriteSync(path, '{"key":"value"}\n');
    expect(readFileSync(path, "utf-8")).toBe('{"key":"value"}\n');
  });

  it("overwrites existing file", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "atomic-"));
    const path = join(tmpDir, "test.json");
    atomicWriteSync(path, "old");
    atomicWriteSync(path, "new");
    expect(readFileSync(path, "utf-8")).toBe("new");
  });

  it("does not leave temp file on success", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "atomic-"));
    const path = join(tmpDir, "test.json");
    atomicWriteSync(path, "data");
    const files = readdirSync(tmpDir);
    expect(files).toEqual(["test.json"]);
  });
});
