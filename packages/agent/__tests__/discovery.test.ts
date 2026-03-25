import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock @mecha/core before importing the module under test
vi.mock("@mecha/core", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    scanTailscalePeers: vi.fn().mockResolvedValue([]),
  };
});

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { runDiscoveryScan, startDiscoveryLoop, SCAN_INTERVAL_MS } from "../src/discovery.js";
import {
  scanTailscalePeers,
  readNodes,
  addNode,
  readDiscoveredNodes,
  writeDiscoveredNode,
} from "@mecha/core";
import type { TailscalePeer, NodeEntry, DiscoveredNode } from "@mecha/core";

const mockedScan = vi.mocked(scanTailscalePeers);

describe("runDiscoveryScan", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "discovery-test-"));
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    rmSync(mechaDir, { recursive: true, force: true });
  });

  it("does nothing when no Tailscale peers are found", async () => {
    mockedScan.mockResolvedValue([]);

    await runDiscoveryScan(mechaDir, "mesh-key");

    expect(readDiscoveredNodes(mechaDir)).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips peers already in the manual node registry", async () => {
    // Add a manual node
    addNode(mechaDir, {
      name: "existing",
      host: "100.64.0.1",
      port: 7660,
      apiKey: "key",
      addedAt: new Date().toISOString(),
    });

    mockedScan.mockResolvedValue([{ ip: "100.64.0.1", hostname: "existing" }]);

    await runDiscoveryScan(mechaDir, "mesh-key");

    // Should not probe the already-registered host
    expect(mockFetch).not.toHaveBeenCalled();
    expect(readDiscoveredNodes(mechaDir)).toHaveLength(0);
  });

  it("registers a new peer when healthz responds ok", async () => {
    mockedScan.mockResolvedValue([
      { ip: "100.64.0.5", hostname: "NewPeer" },
    ]);

    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await runDiscoveryScan(mechaDir, "mesh-key");

    const discovered = readDiscoveredNodes(mechaDir);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]!.name).toBe("newpeer");
    expect(discovered[0]!.host).toBe("100.64.0.5");
    expect(discovered[0]!.port).toBe(7660);
    expect(discovered[0]!.apiKey).toBe("mesh-key");
    expect(discovered[0]!.source).toBe("tailscale");
  });

  it("normalizes hostname with special characters", async () => {
    mockedScan.mockResolvedValue([
      { ip: "100.64.0.6", hostname: "My.Server_01" },
    ]);

    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await runDiscoveryScan(mechaDir, "key");

    const discovered = readDiscoveredNodes(mechaDir);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]!.name).toBe("my-server-01");
  });

  it("skips peers where healthz returns non-ok status", async () => {
    mockedScan.mockResolvedValue([
      { ip: "100.64.0.7", hostname: "offline" },
    ]);

    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    await runDiscoveryScan(mechaDir, "key");

    expect(readDiscoveredNodes(mechaDir)).toHaveLength(0);
  });

  it("refreshes lastSeen for already-discovered peers still visible", async () => {
    // Pre-populate a discovered node with an old lastSeen
    const oldTime = "2020-01-01T00:00:00.000Z";
    writeDiscoveredNode(mechaDir, {
      name: "known",
      host: "100.64.0.10",
      port: 7660,
      apiKey: "key",
      source: "tailscale",
      lastSeen: oldTime,
      addedAt: oldTime,
    });

    mockedScan.mockResolvedValue([
      { ip: "100.64.0.10", hostname: "known" },
    ]);

    await runDiscoveryScan(mechaDir, "key");

    const discovered = readDiscoveredNodes(mechaDir);
    expect(discovered).toHaveLength(1);
    // lastSeen should be updated to a more recent time
    expect(discovered[0]!.lastSeen).not.toBe(oldTime);
  });

  it("cleans up expired discovered nodes", async () => {
    // Add a node with lastSeen far in the past (> 24h)
    const expired = "2000-01-01T00:00:00.000Z";
    writeDiscoveredNode(mechaDir, {
      name: "expired-node",
      host: "100.64.0.20",
      port: 7660,
      apiKey: "key",
      source: "tailscale",
      lastSeen: expired,
      addedAt: expired,
    });

    // Scan returns a different peer so the expired one is not refreshed
    mockedScan.mockResolvedValue([
      { ip: "100.64.0.21", hostname: "fresh" },
    ]);
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await runDiscoveryScan(mechaDir, "key");

    const discovered = readDiscoveredNodes(mechaDir);
    // The expired node should be removed, fresh one should exist
    const names = discovered.map((n) => n.name);
    expect(names).not.toContain("expired-node");
    expect(names).toContain("fresh");
  });

  it("handles multiple peers in a single scan", async () => {
    mockedScan.mockResolvedValue([
      { ip: "100.64.0.30", hostname: "alpha" },
      { ip: "100.64.0.31", hostname: "beta" },
      { ip: "100.64.0.32", hostname: "gamma" },
    ]);

    // alpha: ok, beta: not ok, gamma: ok
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("100.64.0.31")) return { ok: false, status: 503 };
      return { ok: true, status: 200 };
    });

    await runDiscoveryScan(mechaDir, "key");

    const discovered = readDiscoveredNodes(mechaDir);
    const names = discovered.map((n) => n.name);
    expect(names).toContain("alpha");
    expect(names).not.toContain("beta");
    expect(names).toContain("gamma");
    expect(discovered).toHaveLength(2);
  });
});

describe("startDiscoveryLoop", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "discovery-loop-test-"));
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockedScan.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(mechaDir, { recursive: true, force: true });
  });

  it("runs an initial scan immediately", async () => {
    const stop = startDiscoveryLoop(mechaDir, "key");

    // Allow the initial async scan to complete
    await vi.advanceTimersByTimeAsync(0);

    expect(mockedScan).toHaveBeenCalledTimes(1);
    stop();
  });

  it("runs subsequent scans on interval", async () => {
    const stop = startDiscoveryLoop(mechaDir, "key");

    await vi.advanceTimersByTimeAsync(0);
    expect(mockedScan).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
    expect(mockedScan).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
    expect(mockedScan).toHaveBeenCalledTimes(3);

    stop();
  });

  it("stops scanning after cleanup function is called", async () => {
    const stop = startDiscoveryLoop(mechaDir, "key");

    await vi.advanceTimersByTimeAsync(0);
    expect(mockedScan).toHaveBeenCalledTimes(1);

    stop();

    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS * 3);
    // Should still be 1 — no further scans after stop
    expect(mockedScan).toHaveBeenCalledTimes(1);
  });

  it("exports the correct scan interval constant", () => {
    expect(SCAN_INTERVAL_MS).toBe(60_000);
  });
});
