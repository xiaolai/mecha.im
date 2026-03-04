import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSnapshot, writeSnapshot, snapshotPath } from "../src/snapshot.js";
import { createHotCounters, ingestEvent, toSnapshot } from "../src/hot-counters.js";
import type { MeterEvent } from "../src/types.js";

function makeEvent(overrides: Partial<MeterEvent> = {}): MeterEvent {
  return {
    id: "01TEST", ts: "2026-02-26T14:00:00.000Z",
    bot: "researcher", authProfile: "default", workspace: "/ws", tags: [],
    model: "claude-sonnet-4-6", stream: true, status: 200,
    modelActual: "claude-sonnet-4-6", latencyMs: 500, ttftMs: 50,
    inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0,
    cacheReadTokens: 0, costUsd: 0.01, ...overrides,
  };
}

describe("snapshot", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  describe("snapshotPath", () => {
    it("returns snapshot.json path", () => {
      expect(snapshotPath("/meter")).toBe("/meter/snapshot.json");
    });
  });

  describe("readSnapshot", () => {
    it("returns null for non-existent file", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-snap-"));
      expect(readSnapshot(tempDir)).toBeNull();
    });

    it("reads valid snapshot", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-snap-"));
      const counters = createHotCounters("2026-02-26");
      ingestEvent(counters, makeEvent());
      const snap = toSnapshot(counters);
      writeSnapshot(tempDir, snap);

      const read = readSnapshot(tempDir);
      expect(read).not.toBeNull();
      expect(read!.date).toBe("2026-02-26");
      expect(read!.global.today.requests).toBe(1);
    });

    it("returns null for invalid snapshot (missing fields)", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-snap-"));
      const { writeFileSync } = require("node:fs") as typeof import("node:fs");
      writeFileSync(join(tempDir, "snapshot.json"), '{"incomplete": true}');

      expect(readSnapshot(tempDir)).toBeNull();
    });
  });

  describe("writeSnapshot", () => {
    it("creates directory and writes file", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-snap-"));
      const meterDir = join(tempDir, "subdir");
      const counters = createHotCounters("2026-02-26");
      const snap = toSnapshot(counters);
      writeSnapshot(meterDir, snap);

      expect(existsSync(join(meterDir, "snapshot.json"))).toBe(true);
      const raw = readFileSync(join(meterDir, "snapshot.json"), "utf-8");
      expect(JSON.parse(raw).date).toBe("2026-02-26");
    });
  });
});
