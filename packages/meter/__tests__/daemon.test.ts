import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { spawn as spawnChild } from "node:child_process";
import { platform } from "node:os";

// On Linux, isPidMecha reads /proc/<pid>/cmdline and rejects non-mecha processes.
// Tests spawn `sleep` as a stand-in, so mock isPidMecha to always return true on Linux.
if (platform() === "linux") {
  vi.mock("../src/lifecycle.js", async (importOriginal) => {
    const mod = await importOriginal<typeof import("../src/lifecycle.js")>();
    return { ...mod, isPidMecha: () => true };
  });
}

import { startDaemon, stopDaemon, meterDir } from "../src/daemon.js";
import type { DaemonHandle } from "../src/daemon.js";
import { createHotCounters, toSnapshot } from "../src/hot-counters.js";
import { writeSnapshot, readSnapshot } from "../src/snapshot.js";
import { todayUTC } from "../src/query.js";
import { readBudgets, writeBudgets } from "../src/budgets.js";

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

describe("daemon", { timeout: 15_000 }, () => {
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

    // Bind a raw TCP server to guarantee port occupation independent of daemon lifecycle
    const net = await import("node:net");
    const blocker = net.createServer();
    const blockerPort = await new Promise<number>((resolve, reject) => {
      blocker.on("error", reject);
      blocker.listen(0, "127.0.0.1", () => {
        const addr = blocker.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    const dir2 = mkdtempSync(join(tmpdir(), "meter-daemon2-"));
    try {
      await expect(startDaemon({ meterDir: dir2, port: blockerPort, required: false }))
        .rejects.toThrow(/already in use|PORT_CONFLICT/);
    } finally {
      blocker.close();
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
      // Close handle before restoring real timers to avoid timer interaction
      if (handle) { await handle.close(); handle = undefined; }
      vi.useRealTimers();
    }
  });

  it("SIGHUP reloads budgets and pricing", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));

    // Pre-seed snapshot with $100 accumulated cost so budget checks have something to compare against.
    const seeded = createHotCounters(todayUTC());
    seeded.global.today.costUsd = 100;
    seeded.global.today.requests = 50;
    writeSnapshot(tempDir, toSnapshot(seeded));

    handle = await startDaemon({ meterDir: tempDir, port: 0, required: false });

    const addr = handle.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    // Before SIGHUP: no budgets → request passes budget check (gets 405 from upstream, not 429).
    const before = await httpGet(port, "/bot/test/v1/messages");
    expect(before.status).not.toBe(429);

    // Write $50 budget — less than the $100 already spent → should reject
    writeBudgets(tempDir, { global: { dailyUsd: 50 }, byBot: {}, byAuthProfile: {}, byTag: {} });

    // Verify the budget file was written correctly
    const budgets = readBudgets(tempDir);
    expect(budgets.global.dailyUsd).toBe(50);

    // Send SIGHUP to reload budgets into the daemon
    process.emit("SIGHUP", "SIGHUP");
    await new Promise(r => setTimeout(r, 50));

    // After SIGHUP: $100 spent > $50 limit → request should be rejected with 429
    const after = await httpGet(port, "/bot/test/v1/messages");
    expect(after.status).toBe(429);
    expect(JSON.parse(after.body).error).toContain("exceeded daily limit");
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

      const res = await httpGet(port, "/bot/test/v1/messages");
      expect(res.status).toBe(401);
      expect(JSON.parse(res.body).error).toBe("Unauthorized");
    });

    it("rejects requests with wrong Bearer token", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
      handle = await startDaemon({ meterDir: tempDir, port: 0, required: false, authToken: "secret-token" });
      const addr = handle.server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;

      const res = await httpGet(port, "/bot/test/v1/messages", { authorization: "Bearer wrong-token" });
      expect(res.status).toBe(401);
    });

    it("accepts requests with correct Bearer token", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "meter-daemon-"));
      handle = await startDaemon({ meterDir: tempDir, port: 0, required: false, authToken: "secret-token" });
      const addr = handle.server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;

      // With correct token, request passes auth and hits the proxy handler (404 = invalid bot path)
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
