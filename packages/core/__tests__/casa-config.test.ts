import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readCasaConfig, updateCasaConfig } from "../src/casa-config.js";

describe("readCasaConfig", () => {
  let tempDir: string;
  afterEach(() => { if (tempDir) rmSync(tempDir, { recursive: true, force: true }); });

  it("reads valid config", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({
      port: 7700, token: "tok", workspace: "/ws", tags: ["a", "b"],
    }));
    const cfg = readCasaConfig(tempDir);
    expect(cfg).toEqual({
      port: 7700, token: "tok", workspace: "/ws", tags: ["a", "b"],
    });
  });

  it("returns undefined for missing file", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    expect(readCasaConfig(tempDir)).toBeUndefined();
  });

  it("returns undefined for malformed JSON", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), "not-json{{{");
    expect(readCasaConfig(tempDir)).toBeUndefined();
  });

  it("returns undefined for structurally invalid config (missing required fields)", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({ foo: "bar" }));
    expect(readCasaConfig(tempDir)).toBeUndefined();
  });

  it("returns undefined for non-object JSON (null)", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), "null");
    expect(readCasaConfig(tempDir)).toBeUndefined();
  });

  it("returns undefined for array JSON", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), "[]");
    expect(readCasaConfig(tempDir)).toBeUndefined();
  });

  it("normalizes non-array tags to undefined", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({
      port: 7700, token: "tok", workspace: "/ws", tags: "not-an-array",
    }));
    const cfg = readCasaConfig(tempDir);
    expect(cfg).toBeDefined();
    expect(cfg!.tags).toBeUndefined();
  });
});

describe("updateCasaConfig", () => {
  let tempDir: string;
  afterEach(() => { if (tempDir) rmSync(tempDir, { recursive: true, force: true }); });

  it("merges updates into existing config", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({
      port: 7700, token: "tok", workspace: "/ws",
    }));
    updateCasaConfig(tempDir, { tags: ["x", "y"] });
    const cfg = JSON.parse(readFileSync(join(tempDir, "config.json"), "utf-8"));
    expect(cfg.port).toBe(7700);
    expect(cfg.tags).toEqual(["x", "y"]);
  });

  it("overwrites existing tags", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({
      port: 7700, token: "tok", workspace: "/ws", tags: ["old"],
    }));
    updateCasaConfig(tempDir, { tags: ["new1", "new2"] });
    const cfg = JSON.parse(readFileSync(join(tempDir, "config.json"), "utf-8"));
    expect(cfg.tags).toEqual(["new1", "new2"]);
  });

  it("creates config if missing", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-cfg-"));
    updateCasaConfig(tempDir, { tags: ["a"] });
    const cfg = JSON.parse(readFileSync(join(tempDir, "config.json"), "utf-8"));
    expect(cfg.tags).toEqual(["a"]);
  });
});
