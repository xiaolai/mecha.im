import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getCachedSnapshot, invalidateSnapshotCache } from "../src/snapshot-cache.js";

function writeSnapshot(meterDir: string, costUsd: number): void {
  mkdirSync(meterDir, { recursive: true });
  writeFileSync(join(meterDir, "snapshot.json"), JSON.stringify({
    ts: new Date().toISOString(),
    date: "2026-03-02",
    global: {
      today: { requests: 1, errors: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, costUsd, avgLatencyMs: 0 },
      thisMonth: { requests: 1, errors: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, costUsd, avgLatencyMs: 0 },
    },
    byCasa: {}, byAuth: {}, byTag: {},
  }));
}

describe("snapshot cache", () => {
  let dir: string;

  afterEach(() => {
    invalidateSnapshotCache();
    if (dir) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns cached value on repeated calls", () => {
    dir = mkdtempSync(join(tmpdir(), "snap-cache-"));
    const meterDir = join(dir, "meter");
    writeSnapshot(meterDir, 1.00);

    const first = getCachedSnapshot(meterDir);
    expect(first).not.toBeNull();
    expect(first!.global.today.costUsd).toBe(1.00);

    // Overwrite on disk — cache should still return old value
    writeSnapshot(meterDir, 99.00);
    const second = getCachedSnapshot(meterDir);
    expect(second!.global.today.costUsd).toBe(1.00);
  });

  it("refreshes after TTL expires", () => {
    dir = mkdtempSync(join(tmpdir(), "snap-cache-"));
    const meterDir = join(dir, "meter");
    writeSnapshot(meterDir, 1.00);

    const first = getCachedSnapshot(meterDir);
    expect(first!.global.today.costUsd).toBe(1.00);

    // Simulate TTL expiry by advancing Date.now
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockReturnValue(realNow() + 6_000);

    writeSnapshot(meterDir, 5.00);
    const refreshed = getCachedSnapshot(meterDir);
    expect(refreshed!.global.today.costUsd).toBe(5.00);
  });

  it("returns null when no snapshot file exists", () => {
    dir = mkdtempSync(join(tmpdir(), "snap-cache-"));
    const meterDir = join(dir, "meter");
    mkdirSync(meterDir, { recursive: true });
    const result = getCachedSnapshot(meterDir);
    expect(result).toBeNull();
  });

  it("invalidateSnapshotCache clears the cache", () => {
    dir = mkdtempSync(join(tmpdir(), "snap-cache-"));
    const meterDir = join(dir, "meter");
    writeSnapshot(meterDir, 1.00);

    getCachedSnapshot(meterDir);
    writeSnapshot(meterDir, 7.00);
    invalidateSnapshotCache();
    const refreshed = getCachedSnapshot(meterDir);
    expect(refreshed!.global.today.costUsd).toBe(7.00);
  });
});
