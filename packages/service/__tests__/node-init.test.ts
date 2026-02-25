import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nodeInit, readNodeName } from "../src/node-init.js";

describe("nodeInit", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-node-init-"));
  });
  afterEach(() => { rmSync(mechaDir, { recursive: true, force: true }); });

  it("creates node with auto-generated name", () => {
    const result = nodeInit(mechaDir);
    expect(result.created).toBe(true);
    expect(result.name.length).toBeGreaterThan(0);
    expect(result.name.length).toBeLessThanOrEqual(32);
  });

  it("creates node with explicit name", () => {
    const result = nodeInit(mechaDir, { name: "my-node" });
    expect(result.created).toBe(true);
    expect(result.name).toBe("my-node");
  });

  it("is idempotent — returns existing name on second call", () => {
    const first = nodeInit(mechaDir, { name: "alice" });
    const second = nodeInit(mechaDir, { name: "bob" });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.name).toBe("alice");
  });

  it("throws InvalidNameError for invalid name", () => {
    expect(() => nodeInit(mechaDir, { name: "BAD NAME" })).toThrow(/Invalid name/);
  });

  it("throws InvalidNameError when existing node.json has invalid name", () => {
    writeFileSync(join(mechaDir, "node.json"), JSON.stringify({ name: "BAD NAME!", createdAt: "2026-01-01" }));
    expect(() => nodeInit(mechaDir)).toThrow(/Invalid name/);
  });
});

describe("readNodeName", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-node-read-"));
  });
  afterEach(() => { rmSync(mechaDir, { recursive: true, force: true }); });

  it("returns undefined when not initialized", () => {
    expect(readNodeName(mechaDir)).toBeUndefined();
  });

  it("returns node name after initialization", () => {
    nodeInit(mechaDir, { name: "alice" });
    expect(readNodeName(mechaDir)).toBe("alice");
  });

  it("returns undefined when node.json has invalid name", () => {
    writeFileSync(join(mechaDir, "node.json"), JSON.stringify({ name: "BAD NAME!", createdAt: "2026-01-01" }));
    expect(readNodeName(mechaDir)).toBeUndefined();
  });
});
