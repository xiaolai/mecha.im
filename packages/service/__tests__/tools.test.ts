import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mechaToolInstall, mechaToolLs } from "../src/tools.js";

describe("mechaToolInstall", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("installs a tool with manifest", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-tools-test-"));
    const result = mechaToolInstall(tempDir, { name: "web-search", version: "1.0.0", description: "Search the web" });

    expect(result.name).toBe("web-search");
    expect(result.version).toBe("1.0.0");
    expect(existsSync(join(tempDir, "tools", "web-search", "manifest.json"))).toBe(true);
  });

  it("rejects invalid tool name with path traversal", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-tools-test-"));
    expect(() => mechaToolInstall(tempDir, { name: "../etc" })).toThrow("Invalid tool name");
  });

  it("rejects tool name with double dots", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-tools-test-"));
    expect(() => mechaToolInstall(tempDir, { name: "foo..bar" })).toThrow("Invalid tool name");
  });

  it("uses defaults for missing version/description", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-tools-test-"));
    const result = mechaToolInstall(tempDir, { name: "basic" });

    expect(result.version).toBe("0.0.0");
    expect(result.description).toBe("");
  });
});

describe("mechaToolLs", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns empty list when no tools installed", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-tools-test-"));
    expect(mechaToolLs(tempDir)).toEqual([]);
  });

  it("lists installed tools", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-tools-test-"));
    mechaToolInstall(tempDir, { name: "tool-a", version: "1.0.0" });
    mechaToolInstall(tempDir, { name: "tool-b", version: "2.0.0" });

    const tools = mechaToolLs(tempDir);
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(["tool-a", "tool-b"]);
  });

  it("returns empty when tools dir does not exist", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-tools-test-"));
    // Don't create tools dir
    expect(mechaToolLs(join(tempDir, "nonexistent"))).toEqual([]);
  });

  it("skips directories without manifest", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-tools-test-"));
    mkdirSync(join(tempDir, "tools", "no-manifest"), { recursive: true });
    mechaToolInstall(tempDir, { name: "valid" });

    const tools = mechaToolLs(tempDir);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("valid");
  });

  it("skips malformed manifests", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-tools-test-"));
    mkdirSync(join(tempDir, "tools", "bad"), { recursive: true });
    writeFileSync(join(tempDir, "tools", "bad", "manifest.json"), "not-json{{{");
    mechaToolInstall(tempDir, { name: "good" });

    const tools = mechaToolLs(tempDir);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("good");
  });

  it("skips manifests with missing required fields", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-tools-test-"));
    mkdirSync(join(tempDir, "tools", "incomplete"), { recursive: true });
    writeFileSync(join(tempDir, "tools", "incomplete", "manifest.json"), JSON.stringify({ name: "x" }));
    mechaToolInstall(tempDir, { name: "good" });

    const tools = mechaToolLs(tempDir);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("good");
  });

  it("skips non-directory entries in tools dir", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-tools-test-"));
    mkdirSync(join(tempDir, "tools"), { recursive: true });
    writeFileSync(join(tempDir, "tools", "random-file.txt"), "not a tool");
    mechaToolInstall(tempDir, { name: "valid" });

    const tools = mechaToolLs(tempDir);
    expect(tools).toHaveLength(1);
  });
});
