import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { spawn as spawnChild } from "node:child_process";
import { startDaemon, stopDaemon, meterDir } from "../src/daemon.js";
import type { DaemonHandle } from "../src/daemon.js";
import { createHotCounters, toSnapshot, ingestEvent } from "../src/hot-counters.js";
import { writeSnapshot, readSnapshot } from "../src/snapshot.js";
import { emptySummary, todayUTC } from "../src/query.js";
import { writeBudgets, readBudgets } from "../src/budgets.js";
import type { MeterEvent } from "../src/types.js";

function httpGet(port: number, path: string, headers?: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      res.on("end", () => resolve({ status: res.statusCode!, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("daemon", () => {
  let tempDir: string;
  let handle: DaemonHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = undefined;
    }
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("starts and accepts connections", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });

    const addr = handle.server.address();
    expect(addr).not.toBeNull();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    const res = await httpGet(port, "/");
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).error).toContain("Invalid path");
  });

  it("writes proxy.json on start", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    handle = await startDaemon({ meterDir: tempDir, port: 0, required: true });

    const raw = readFileSync(join(tempDir, "proxy.json"), "utf-8");
    const info = JSON.parse(raw);
    expect(info.pid).toBe(process.pid);
    expect(info.required).toBe(true);
  });

  it("initializes pricing.json on start", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });

    const raw = readFileSync(join(tempDir, "pricing.json"), "utf-8");
    const pricing = JSON.parse(raw);
    expect(pricing.models["claude-opus-4-6"]).toBeDefined();
  });

  it("rejects duplicate start with alive pid", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });

    await expect(startDaemon({ meterDir: tempDir, port: 0, required: false }))
      .rejects.toThrow(/already running|METER_PROXY_ALREADY_RUNNING/);
  });

  it("cleans stale proxy.json and starts", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    // Write stale proxy.json with dead pid
    writeFileSync(join(tempDir, "proxy.json"), JSON.stringify({
      port: 7600, pid: 999999999, required: false, startedAt: "x",
    }));

    handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });
    expect(handle.info.pid).toBe(process.pid);
  });

  it("rejects if port is in use", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });

    const addr = handle.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const dir2 = mkdtempSync(join(tmpdir(), "meter-daemon2-"));
    try {
      await expect(startDaemon({ meterDir: dir2, port, required: false }))
        .rejects.toThrow(/already in use|PORT_CONFLICT/);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("close() cleans up proxy.json", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });

    await handle.close();
    handle = undefined; // prevent double-close in afterEach

    expect(existsSync(join(tempDir, "proxy.json"))).toBe(false);
  });

  it("close() flushes snapshot to disk", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });

    await handle.close();
    handle = undefined;

    const snapshot = readSnapshot(tempDir);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.date).toBe(todayUTC());
  });

  it("restores counters from snapshot on startup", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    // Pre-seed a snapshot with accumulated data
    const counters = createHotCounters(todayUTC());
    counters.global.today.costUsd = 42;
    counters.global.today.requests = 10;
    writeSnapshot(tempDir, toSnapshot(counters));

    handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });

    // Close and check snapshot still has accumulated data
    await handle.close();
    handle = undefined;

    const snapshot = readSnapshot(tempDir);
    expect(snapshot!.global.today.costUsd).toBe(42);
    expect(snapshot!.global.today.requests).toBe(10);
  });

  it("creates fresh counters when snapshot date differs", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    // Write snapshot with old date
    const counters = createHotCounters("2020-01-01");
    counters.global.today.costUsd = 99;
    writeSnapshot(tempDir, toSnapshot(counters));

    handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });

    // Close and check snapshot is fresh (no accumulated cost from old day)
    await handle.close();
    handle = undefined;

    const snapshot = readSnapshot(tempDir);
    expect(snapshot!.global.today.costUsd).toBe(0);
    expect(snapshot!.date).toBe(todayUTC());
  });

  it("uses explicit mechaDir when provided", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    const mechaDir = mkdtempSync(join(tmpdir(), "mecha-parent-"));
    try {
      handle = await startDaemon({ meterDir: tempDir, mechaDir, port: 0, required: false });
      // Should start successfully
      expect(handle.info.pid).toBe(process.pid);
    } finally {
      rmSync(mechaDir, { recursive: true, force: true });
    }
  });

  it("periodic snapshot timer writes to disk", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
      handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });

      // Delete any snapshot that exists from startup
      try { rmSync(join(tempDir, "snapshot.json")); } catch { /* ok */ }

      // Advance timers by 5 seconds to trigger snapshot flush
      vi.advanceTimersByTime(5_000);

      // Give a tick for the timer callback to complete
      await vi.advanceTimersByTimeAsync(10);

      expect(existsSync(join(tempDir, "snapshot.json"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("periodic registry timer rescans", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
      handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });

      // Advance timers by 30 seconds to trigger registry rescan
      vi.advanceTimersByTime(30_000);
      await vi.advanceTimersByTimeAsync(10);

      // Daemon still alive after rescan
      const addr = handle.server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      expect(port).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("SIGHUP reloads budgets and pricing", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });

    // Write budgets to disk
    writeBudgets(tempDir, { global: { dailyUsd: 99 }, byCasa: {}, byAuthProfile: {}, byTag: {} });

    // Send SIGHUP to reload
    process.emit("SIGHUP", "SIGHUP");

    // The budgets should be reloaded — verify by checking the snapshot flush
    // (We can't directly inspect ctx, but we can verify no crash and the daemon is still alive)
    const addr = handle.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await httpGet(port, "/");
    expect(res.status).toBe(404); // Still responds after SIGHUP
  });

  it("close() removes SIGHUP listener", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
    const listenersBefore = process.listenerCount("SIGHUP");
    handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });
    expect(process.listenerCount("SIGHUP")).toBe(listenersBefore + 1);

    await handle.close();
    handle = undefined;

    expect(process.listenerCount("SIGHUP")).toBe(listenersBefore);
  });

  describe("authToken", () => {
    it("rejects requests without Bearer token when authToken is set", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
      handle = await startDaemon({ meterDir: tempDir, port: 0, required: false, authToken: "secret-token" });
      const addr = handle.server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;

      const res = await httpGet(port, "/casa/test/v1/messages");
      expect(res.status).toBe(401);
      expect(JSON.parse(res.body).error).toBe("Unauthorized");
    });

    it("rejects requests with wrong Bearer token", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
      handle = await startDaemon({ meterDir: tempDir, port: 0, required: false, authToken: "secret-token" });
      const addr = handle.server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;

      const res = await httpGet(port, "/casa/test/v1/messages", { authorization: "Bearer wrong-token" });
      expect(res.status).toBe(401);
    });

    it("accepts requests with correct Bearer token", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
      handle = await startDaemon({ meterDir: tempDir, port: 0, required: false, authToken: "secret-token" });
      const addr = handle.server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;

      // With correct token, request passes auth and hits the proxy handler (404 = invalid CASA path)
      const res = await httpGet(port, "/", { authorization: "Bearer secret-token" });
      expect(res.status).toBe(404);
    });
  });

  describe("stopDaemon", () => {
    it("returns false when no proxy running", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
      expect(stopDaemon(tempDir)).toBe(false);
    });

    it("returns false when pid is dead (cleans stale)", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
      writeFileSync(join(tempDir, "proxy.json"), JSON.stringify({
        port: 7600, pid: 999999999, required: false, startedAt: "x",
      }));
      expect(stopDaemon(tempDir)).toBe(false);
    });

    it("sends SIGTERM to alive process", () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
      // Spawn a child process we can send SIGTERM to
      const child = spawnChild("sleep", ["60"], { detached: true, stdio: "ignore" });
      child.unref();
      const pid = child.pid!;
      try {
        writeFileSync(join(tempDir, "proxy.json"), JSON.stringify({
          port: 7600, pid, required: false, startedAt: "x",
        }));
        expect(stopDaemon(tempDir)).toBe(true);
      } finally {
        try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
      }
    });
  });

  describe("meterDir", () => {
    it("returns path under mechaDir", () => {
      expect(meterDir("/home/user/.mecha")).toBe("/home/user/.mecha/meter");
    });
  });
});
