import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadAcl, saveAcl } from "../../src/acl/persistence.js";

describe("loadAcl", () => {
  it("returns empty rules for nonexistent file", () => {
    const dir = mkdtempSync(join(tmpdir(), "mecha-acl-p-"));
    const data = loadAcl(dir);
    expect(data.version).toBe(1);
    expect(data.rules).toEqual([]);
  });
});

describe("saveAcl + loadAcl round-trip", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-acl-rtrip-"));
  });

  it("persists and reloads rules", () => {
    const data = {
      version: 1,
      rules: [
        { source: "coder", target: "researcher", capabilities: ["query" as const, "read_workspace" as const] },
      ],
    };
    saveAcl(mechaDir, data);
    expect(existsSync(join(mechaDir, "acl.json"))).toBe(true);

    const loaded = loadAcl(mechaDir);
    expect(loaded.version).toBe(1);
    expect(loaded.rules).toHaveLength(1);
    expect(loaded.rules[0]!.source).toBe("coder");
    expect(loaded.rules[0]!.capabilities).toEqual(["query", "read_workspace"]);
  });

  it("handles empty rules array", () => {
    saveAcl(mechaDir, { version: 1, rules: [] });
    const loaded = loadAcl(mechaDir);
    expect(loaded.rules).toEqual([]);
  });

  it("returns empty for corrupt JSON", () => {

    writeFileSync(join(mechaDir, "acl.json"), "not-json{{{");
    const loaded = loadAcl(mechaDir);
    expect(loaded).toEqual({ version: 1, rules: [] });
  });

  it("returns empty for valid JSON with invalid schema", () => {

    writeFileSync(join(mechaDir, "acl.json"), JSON.stringify({ version: "bad", rules: [] }));
    const loaded = loadAcl(mechaDir);
    expect(loaded).toEqual({ version: 1, rules: [] });
  });

  it("returns empty when rules contain invalid capabilities", () => {

    writeFileSync(join(mechaDir, "acl.json"), JSON.stringify({
      version: 1,
      rules: [{ source: "a", target: "b", capabilities: ["bogus_cap"] }],
    }));
    const loaded = loadAcl(mechaDir);
    expect(loaded).toEqual({ version: 1, rules: [] });
  });

  it("returns empty when rule missing source", () => {

    writeFileSync(join(mechaDir, "acl.json"), JSON.stringify({
      version: 1,
      rules: [{ target: "b", capabilities: ["query"] }],
    }));
    const loaded = loadAcl(mechaDir);
    expect(loaded).toEqual({ version: 1, rules: [] });
  });

  it("returns empty when rules field is not an array", () => {

    writeFileSync(join(mechaDir, "acl.json"), JSON.stringify({ version: 1, rules: "not-array" }));
    const loaded = loadAcl(mechaDir);
    expect(loaded).toEqual({ version: 1, rules: [] });
  });

  it("returns empty when rule capabilities is not an array", () => {

    writeFileSync(join(mechaDir, "acl.json"), JSON.stringify({
      version: 1,
      rules: [{ source: "a", target: "b", capabilities: "query" }],
    }));
    const loaded = loadAcl(mechaDir);
    expect(loaded).toEqual({ version: 1, rules: [] });
  });

  it("returns empty when rule is null", () => {

    writeFileSync(join(mechaDir, "acl.json"), JSON.stringify({
      version: 1,
      rules: [null],
    }));
    const loaded = loadAcl(mechaDir);
    expect(loaded).toEqual({ version: 1, rules: [] });
  });

  it("returns empty when data is null JSON", () => {

    writeFileSync(join(mechaDir, "acl.json"), "null");
    const loaded = loadAcl(mechaDir);
    expect(loaded).toEqual({ version: 1, rules: [] });
  });
});
