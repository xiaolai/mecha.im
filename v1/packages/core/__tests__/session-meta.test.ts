import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getSessionMeta,
  setSessionMeta,
  getAllSessionMeta,
  deleteSessionMeta,
} from "../src/session-meta.js";

let tmpDir: string;
let originalHome: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "meta-test-"));
  originalHome = process.env.HOME ?? "";
  // Override homedir() by setting HOME env var
  vi.stubEnv("HOME", tmpDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("getSessionMeta", () => {
  it("returns empty object when no metadata exists", () => {
    const meta = getSessionMeta("mecha-1", "session-abc");
    expect(meta).toEqual({});
  });

  it("returns stored metadata after set", () => {
    setSessionMeta("mecha-1", "session-abc", { starred: true, customTitle: "My Session" });
    const meta = getSessionMeta("mecha-1", "session-abc");
    expect(meta).toEqual({ starred: true, customTitle: "My Session" });
  });
});

describe("setSessionMeta", () => {
  it("merges with existing metadata", () => {
    setSessionMeta("mecha-1", "s1", { starred: true });
    setSessionMeta("mecha-1", "s1", { customTitle: "Updated" });
    const meta = getSessionMeta("mecha-1", "s1");
    expect(meta).toEqual({ starred: true, customTitle: "Updated" });
  });

  it("removes keys set to undefined", () => {
    setSessionMeta("mecha-1", "s1", { starred: true, customTitle: "Title" });
    setSessionMeta("mecha-1", "s1", { customTitle: undefined });
    const meta = getSessionMeta("mecha-1", "s1");
    expect(meta).toEqual({ starred: true });
  });

  it("cleans up empty session entries and removes mecha key when last session is cleared", () => {
    setSessionMeta("mecha-1", "s1", { starred: true });
    setSessionMeta("mecha-1", "s1", { starred: undefined });
    const all = getAllSessionMeta("mecha-1");
    expect(all).toEqual({});
  });

  it("keeps mecha key when other sessions still exist after removing one", () => {
    setSessionMeta("mecha-1", "s1", { starred: true });
    setSessionMeta("mecha-1", "s2", { customTitle: "Keep me" });
    // Clear s1 completely
    setSessionMeta("mecha-1", "s1", { starred: undefined });
    const all = getAllSessionMeta("mecha-1");
    // s1 is gone but s2 remains
    expect(all).toEqual({ s2: { customTitle: "Keep me" } });
  });

  it("writes valid JSON to disk", () => {
    setSessionMeta("mecha-1", "s1", { starred: true });
    const raw = readFileSync(join(tmpDir, ".mecha", "session-meta.json"), "utf-8");
    const data = JSON.parse(raw);
    expect(data["mecha-1"]["s1"]).toEqual({ starred: true });
  });

  it("supports multiple mechas independently", () => {
    setSessionMeta("mecha-1", "s1", { starred: true });
    setSessionMeta("mecha-2", "s1", { customTitle: "Different" });

    expect(getSessionMeta("mecha-1", "s1")).toEqual({ starred: true });
    expect(getSessionMeta("mecha-2", "s1")).toEqual({ customTitle: "Different" });
  });
});

describe("getAllSessionMeta", () => {
  it("returns empty object when mecha has no metadata", () => {
    expect(getAllSessionMeta("nonexistent")).toEqual({});
  });

  it("returns all session metadata for a mecha", () => {
    setSessionMeta("mecha-1", "s1", { starred: true });
    setSessionMeta("mecha-1", "s2", { customTitle: "Second" });

    const all = getAllSessionMeta("mecha-1");
    expect(all).toEqual({
      s1: { starred: true },
      s2: { customTitle: "Second" },
    });
  });
});

describe("deleteSessionMeta", () => {
  it("removes a specific session entry", () => {
    setSessionMeta("mecha-1", "s1", { starred: true });
    setSessionMeta("mecha-1", "s2", { customTitle: "Keep" });
    deleteSessionMeta("mecha-1", "s1");
    expect(getSessionMeta("mecha-1", "s1")).toEqual({});
    expect(getSessionMeta("mecha-1", "s2")).toEqual({ customTitle: "Keep" });
  });

  it("cleans up mecha key when last session is deleted", () => {
    setSessionMeta("mecha-1", "s1", { starred: true });
    deleteSessionMeta("mecha-1", "s1");
    expect(getAllSessionMeta("mecha-1")).toEqual({});
  });

  it("is a no-op when session does not exist", () => {
    setSessionMeta("mecha-1", "s1", { starred: true });
    deleteSessionMeta("mecha-1", "nonexistent");
    // Original data untouched
    expect(getSessionMeta("mecha-1", "s1")).toEqual({ starred: true });
  });

  it("is a no-op when mecha does not exist", () => {
    deleteSessionMeta("nonexistent", "s1");
    expect(getAllSessionMeta("nonexistent")).toEqual({});
  });
});
