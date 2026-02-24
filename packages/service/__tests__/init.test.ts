import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mechaInit } from "../src/init.js";

describe("mechaInit", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates directory structure", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-init-test-"));
    const mechaDir = join(tempDir, ".mecha");

    const result = mechaInit(mechaDir);
    expect(result.created).toBe(true);
    expect(result.mechaDir).toBe(mechaDir);
    expect(existsSync(join(mechaDir, "casas"))).toBe(true);
    expect(existsSync(join(mechaDir, "auth"))).toBe(true);
    expect(existsSync(join(mechaDir, "tools"))).toBe(true);
    expect(existsSync(join(mechaDir, "logs"))).toBe(true);
  });

  it("generates node-id on first run", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-init-test-"));
    const mechaDir = join(tempDir, ".mecha");

    const result = mechaInit(mechaDir);
    expect(result.nodeId).toBeDefined();
    expect(result.nodeId.length).toBeGreaterThan(0);

    const savedId = readFileSync(join(mechaDir, "node-id"), "utf-8").trim();
    expect(savedId).toBe(result.nodeId);
  });

  it("preserves existing node-id on re-init", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-init-test-"));
    const mechaDir = join(tempDir, ".mecha");

    const first = mechaInit(mechaDir);
    const second = mechaInit(mechaDir);

    expect(second.nodeId).toBe(first.nodeId);
    expect(second.created).toBe(false);
  });
});
