import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { safeReadJson } from "../src/safe-read.js";

describe("safeReadJson", () => {
  let tempDir: string;
  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns missing when file does not exist", () => {
    tempDir = mkdtempSync(join(tmpdir(), "safe-read-"));
    const result = safeReadJson(join(tempDir, "nope.json"), "test");
    expect(result).toEqual({ ok: false, reason: "missing", detail: "test: file not found" });
  });

  it("returns ok with parsed data for valid JSON", () => {
    tempDir = mkdtempSync(join(tmpdir(), "safe-read-"));
    const filePath = join(tempDir, "data.json");
    writeFileSync(filePath, JSON.stringify({ foo: "bar" }));
    const result = safeReadJson(filePath, "test");
    expect(result).toEqual({ ok: true, data: { foo: "bar" } });
  });

  it("returns corrupt when JSON is invalid", () => {
    tempDir = mkdtempSync(join(tmpdir(), "safe-read-"));
    const filePath = join(tempDir, "bad.json");
    writeFileSync(filePath, "not-json{{{");
    const result = safeReadJson(filePath, "test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("corrupt");
      expect(result.detail).toContain("test: invalid JSON");
    }
  });

  it("validates with Zod schema when provided", () => {
    tempDir = mkdtempSync(join(tmpdir(), "safe-read-"));
    const filePath = join(tempDir, "valid.json");
    const schema = z.object({ name: z.string(), age: z.number() });
    writeFileSync(filePath, JSON.stringify({ name: "alice", age: 30 }));
    const result = safeReadJson(filePath, "test", schema);
    expect(result).toEqual({ ok: true, data: { name: "alice", age: 30 } });
  });

  it("returns corrupt when Zod schema validation fails", () => {
    tempDir = mkdtempSync(join(tmpdir(), "safe-read-"));
    const filePath = join(tempDir, "invalid.json");
    const schema = z.object({ name: z.string(), age: z.number() });
    writeFileSync(filePath, JSON.stringify({ name: 123 }));
    const result = safeReadJson(filePath, "test", schema);
    expect(result).toEqual({ ok: false, reason: "corrupt", detail: "test: schema validation failed" });
  });

  it("returns unreadable when file cannot be read", () => {
    tempDir = mkdtempSync(join(tmpdir(), "safe-read-"));
    const filePath = join(tempDir, "locked.json");
    writeFileSync(filePath, "{}");
    chmodSync(filePath, 0o000);
    const result = safeReadJson(filePath, "test");
    // Restore permissions for cleanup
    chmodSync(filePath, 0o644);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unreadable");
      expect(result.detail).toContain("test:");
    }
  });
});
