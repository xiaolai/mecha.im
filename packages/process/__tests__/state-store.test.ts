import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StateStore, isPidAlive } from "../src/state-store.js";
import type { MechaProcessInfo } from "../src/types.js";
import type { MechaId } from "@mecha/core";

function makeInfo(overrides: Partial<MechaProcessInfo> = {}): MechaProcessInfo {
  return {
    id: "mx-test-abc123" as MechaId,
    pid: 12345,
    port: 7700,
    projectPath: "/tmp/test-project",
    state: "running",
    authToken: "test-token",
    env: { MECHA_ID: "mx-test-abc123" },
    createdAt: "2025-01-01T00:00:00.000Z",
    startedAt: "2025-01-01T00:00:00.000Z",
    startFingerprint: "12345:1000000000",
    ...overrides,
  };
}

describe("StateStore", () => {
  let dir: string;
  let store: StateStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mecha-state-test-"));
    store = new StateStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates directory if it does not exist", () => {
    const nested = join(dir, "nested", "deep");
    const s = new StateStore(nested);
    expect(existsSync(nested)).toBe(true);
  });

  it("saves and loads process info", () => {
    const info = makeInfo();
    store.save(info);
    const loaded = store.load(info.id);
    expect(loaded).toEqual(info);
  });

  it("returns undefined for non-existent ID", () => {
    expect(store.load("mx-nonexistent-000000")).toBeUndefined();
  });

  it("overwrites existing info on save", () => {
    const info = makeInfo();
    store.save(info);
    const updated = { ...info, state: "stopped" as const };
    store.save(updated);
    const loaded = store.load(info.id);
    expect(loaded!.state).toBe("stopped");
  });

  it("removes state file", () => {
    const info = makeInfo();
    store.save(info);
    store.remove(info.id);
    expect(store.load(info.id)).toBeUndefined();
  });

  it("remove is a no-op for non-existent ID", () => {
    expect(() => store.remove("mx-nonexistent-000000")).not.toThrow();
  });

  it("lists all stored infos", () => {
    const info1 = makeInfo({ id: "mx-test1-111111" as MechaId });
    const info2 = makeInfo({ id: "mx-test2-222222" as MechaId });
    store.save(info1);
    store.save(info2);
    const all = store.listAll();
    expect(all).toHaveLength(2);
    const ids = all.map((i) => i.id).sort();
    expect(ids).toEqual(["mx-test1-111111", "mx-test2-222222"]);
  });

  it("returns empty array when no files exist", () => {
    expect(store.listAll()).toEqual([]);
  });

  it("skips corrupt JSON files in listAll", () => {
    const info = makeInfo();
    store.save(info);
    // Write a corrupt file
    writeFileSync(join(dir, "corrupt.json"), "not json{{{");
    const all = store.listAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(info.id);
  });

  it("returns undefined for corrupt JSON on load", () => {
    writeFileSync(join(dir, "mx-corrupt-000000.json"), "invalid");
    expect(store.load("mx-corrupt-000000")).toBeUndefined();
  });

  it("handles listAll when dir does not exist", () => {
    rmSync(dir, { recursive: true, force: true });
    // Create a new store with removed dir — listAll should handle gracefully
    expect(store.listAll()).toEqual([]);
  });
});

describe("isPidAlive", () => {
  it("returns true for the current process PID", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it("returns false for a very high PID unlikely to exist", () => {
    expect(isPidAlive(999999999)).toBe(false);
  });
});
