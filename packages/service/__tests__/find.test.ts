import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { casaFind } from "../src/casa.js";
import type { CasaName } from "@mecha/core";
import type { ProcessManager, ProcessInfo } from "@mecha/process";

function makeInfo(name: string, overrides?: Partial<ProcessInfo>): ProcessInfo {
  return {
    name: name as CasaName,
    state: "running",
    pid: 1000,
    port: 7700,
    workspacePath: "/ws",
    startedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function createMockPM(overrides: Partial<ProcessManager> = {}): ProcessManager {
  return {
    spawn: vi.fn(),
    get: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    stop: vi.fn(),
    kill: vi.fn(),
    logs: vi.fn(),
    getPortAndToken: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  } as ProcessManager;
}

describe("casaFind", () => {
  let mechaDir: string;
  afterEach(() => { if (mechaDir) rmSync(mechaDir, { recursive: true, force: true }); });

  function writeCasaConfig(name: string, tags: string[]): void {
    const dir = join(mechaDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws", tags }));
  }

  it("returns all CASAs with tags when no filter", () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    writeCasaConfig("alice", ["research"]);
    writeCasaConfig("bob", ["code"]);
    const pm = createMockPM({
      list: vi.fn().mockReturnValue([makeInfo("alice"), makeInfo("bob")]),
    });

    const results = casaFind(mechaDir, pm, {});
    expect(results).toHaveLength(2);
    expect(results[0].tags).toEqual(["research"]);
    expect(results[1].tags).toEqual(["code"]);
  });

  it("filters by single tag", () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    writeCasaConfig("alice", ["research", "papers"]);
    writeCasaConfig("bob", ["code"]);
    const pm = createMockPM({
      list: vi.fn().mockReturnValue([makeInfo("alice"), makeInfo("bob")]),
    });

    const results = casaFind(mechaDir, pm, { tags: ["research"] });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("alice");
  });

  it("filters by multiple tags with AND logic", () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    writeCasaConfig("alice", ["code", "typescript"]);
    writeCasaConfig("bob", ["code", "review"]);
    const pm = createMockPM({
      list: vi.fn().mockReturnValue([makeInfo("alice"), makeInfo("bob")]),
    });

    const results = casaFind(mechaDir, pm, { tags: ["code", "review"] });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("bob");
  });

  it("returns empty for no matches", () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    writeCasaConfig("alice", ["research"]);
    const pm = createMockPM({
      list: vi.fn().mockReturnValue([makeInfo("alice")]),
    });

    const results = casaFind(mechaDir, pm, { tags: ["nonexistent"] });
    expect(results).toHaveLength(0);
  });

  it("skips CASAs with invalid names", () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    const pm = createMockPM({
      list: vi.fn().mockReturnValue([
        { ...makeInfo("alice"), name: "../traversal" as unknown as import("@mecha/core").CasaName },
      ]),
    });

    const results = casaFind(mechaDir, pm, {});
    expect(results).toHaveLength(0);
  });

  it("filters non-string entries from tags array", () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    const dir = join(mechaDir, "alice");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({
      port: 7700, token: "t", workspace: "/ws", tags: ["valid", 123, null, "also-valid"],
    }));
    const pm = createMockPM({
      list: vi.fn().mockReturnValue([makeInfo("alice")]),
    });

    const results = casaFind(mechaDir, pm, {});
    expect(results).toHaveLength(1);
    expect(results[0].tags).toEqual(["valid", "also-valid"]);
  });

  it("defaults to empty tags for CASAs without tags field", () => {
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-find-"));
    const dir = join(mechaDir, "alice");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ port: 7700, token: "t", workspace: "/ws" }));
    const pm = createMockPM({
      list: vi.fn().mockReturnValue([makeInfo("alice")]),
    });

    const results = casaFind(mechaDir, pm, {});
    expect(results).toHaveLength(1);
    expect(results[0].tags).toEqual([]);
  });
});
