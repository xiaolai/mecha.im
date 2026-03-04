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

  it("creates directory structure with discovery index", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-init-test-"));
    const mechaDir = join(tempDir, ".mecha");

    const result = mechaInit(mechaDir);
    expect(result.created).toBe(true);
    expect(result.mechaDir).toBe(mechaDir);
    expect(existsSync(join(mechaDir, "auth"))).toBe(true);
    expect(existsSync(join(mechaDir, "tools"))).toBe(true);
    expect(existsSync(join(mechaDir, "logs"))).toBe(true);
    // Discovery index created
    expect(existsSync(join(mechaDir, "discovery.json"))).toBe(true);
    const index = JSON.parse(readFileSync(join(mechaDir, "discovery.json"), "utf-8"));
    expect(index.version).toBe(1);
    expect(index.bots).toEqual([]);
  });

  it("generates node-id and keypair on first run", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-init-test-"));
    const mechaDir = join(tempDir, ".mecha");

    const result = mechaInit(mechaDir);
    expect(result.nodeId).toBeDefined();
    expect(result.nodeId.length).toBeGreaterThan(0);
    expect(result.fingerprint).toMatch(/^[0-9a-f]{16}$/);

    const savedId = readFileSync(join(mechaDir, "node-id"), "utf-8").trim();
    expect(savedId).toBe(result.nodeId);
    expect(existsSync(join(mechaDir, "identity", "node.json"))).toBe(true);
    expect(existsSync(join(mechaDir, "identity", "node.key"))).toBe(true);
  });

  it("preserves existing node-id and keypair on re-init", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-init-test-"));
    const mechaDir = join(tempDir, ".mecha");

    const first = mechaInit(mechaDir);
    const second = mechaInit(mechaDir);

    expect(second.nodeId).toBe(first.nodeId);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.created).toBe(false);
  });
});
