import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";

// Mock @mecha/core before importing the module under test
vi.mock("@mecha/core", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    scanTailscalePeers: vi.fn().mockResolvedValue([]),
  };
});

// ── Mock bonjour-service ──────────────────────────────────────────
// scanMdnsPeers creates a Bonjour instance per scan.
// startMdnsAdvertise creates a long-lived instance for advertising.
// We mock the Bonjour constructor to control both paths.
const mockBrowser = new EventEmitter() as EventEmitter & { stop: ReturnType<typeof vi.fn> };
mockBrowser.stop = vi.fn();

const mockPublishedService = {
  stop: vi.fn((cb?: () => void) => { if (cb) cb(); }),
  on: vi.fn(),
};

const mockBonjourInstance = {
  find: vi.fn().mockReturnValue(mockBrowser),
  publish: vi.fn().mockReturnValue(mockPublishedService),
  destroy: vi.fn(),
};

vi.mock("bonjour-service", () => {
  // Use a real class so `new Bonjour()` works as a constructor
  class MockBonjour {
    find = mockBonjourInstance.find;
    publish = mockBonjourInstance.publish;
    destroy = mockBonjourInstance.destroy;
  }
  return { Bonjour: MockBonjour };
});

// Mock node:os networkInterfaces to control self-discovery filtering
const { mockNetworkInterfaces } = vi.hoisted(() => ({
  mockNetworkInterfaces: vi.fn().mockReturnValue({}),
}));
vi.mock("node:os", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, networkInterfaces: mockNetworkInterfaces };
});

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  runDiscoveryScan,
  startDiscoveryLoop,
  startMdnsAdvertise,
  scanMdnsPeers,
  SCAN_INTERVAL_MS,
  MDNS_BROWSE_TIMEOUT_MS,
  MDNS_DEBOUNCE_MS,
} from "../src/discovery.js";
import {
  scanTailscalePeers,
  addNode,
  readDiscoveredNodes,
  writeDiscoveredNode,
} from "@mecha/core";

const mockedScan = vi.mocked(scanTailscalePeers);

// ── runDiscoveryScan ──────────────────────────────────────────────

describe("runDiscoveryScan", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "discovery-test-"));
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockFetch.mockReset();
    // Return no local IPs by default so peers aren't filtered as self
    mockNetworkInterfaces.mockReturnValue({});
    // Reset the browser emitter — remove all listeners from previous tests
    mockBrowser.removeAllListeners();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(mechaDir, { recursive: true, force: true });
  });

  // Helper: run scan and advance past mDNS browse timeout
  async function runScanWithTimer(dir: string, key: string): Promise<void> {
    const p = runDiscoveryScan(dir, key);
    await vi.advanceTimersByTimeAsync(MDNS_BROWSE_TIMEOUT_MS + 100);
    return p;
  }

  it("cleans up expired nodes even when no peers are found", async () => {
    const expired = "2000-01-01T00:00:00.000Z";
    writeDiscoveredNode(mechaDir, {
      name: "stale-node",
      host: "100.64.0.99",
      port: 7660,
      apiKey: "key",
      source: "tailscale",
      lastSeen: expired,
      addedAt: expired,
    });
    expect(readDiscoveredNodes(mechaDir)).toHaveLength(1);

    mockedScan.mockResolvedValue([]);

    await runScanWithTimer(mechaDir, "mesh-key");

    expect(readDiscoveredNodes(mechaDir)).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips peers already in the manual node registry", async () => {
    addNode(mechaDir, {
      name: "existing",
      host: "100.64.0.1",
      port: 7660,
      apiKey: "key",
      addedAt: new Date().toISOString(),
    });

    mockedScan.mockResolvedValue([{ ip: "100.64.0.1", hostname: "existing" }]);

    await runScanWithTimer(mechaDir, "mesh-key");

    expect(mockFetch).not.toHaveBeenCalled();
    expect(readDiscoveredNodes(mechaDir)).toHaveLength(0);
  });

  it("registers a new peer when healthz and authenticated /bots both succeed", async () => {
    mockedScan.mockResolvedValue([
      { ip: "100.64.0.5", hostname: "NewPeer" },
    ]);

    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await runScanWithTimer(mechaDir, "mesh-key");

    const discovered = readDiscoveredNodes(mechaDir);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]!.name).toBe("newpeer");
    expect(discovered[0]!.host).toBe("100.64.0.5");
    expect(discovered[0]!.port).toBe(7660);
    expect(discovered[0]!.apiKey).toBe("mesh-key");
    expect(discovered[0]!.source).toBe("tailscale");
    // Both healthz and authenticated /bots calls should have been made
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("normalizes hostname with special characters", async () => {
    mockedScan.mockResolvedValue([
      { ip: "100.64.0.6", hostname: "My.Server_01" },
    ]);

    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await runScanWithTimer(mechaDir, "key");

    const discovered = readDiscoveredNodes(mechaDir);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]!.name).toBe("my-server-01");
  });

  it("skips peers where authenticated /bots probe fails after healthz succeeds", async () => {
    mockedScan.mockResolvedValue([
      { ip: "100.64.0.8", hostname: "wrongkey" },
    ]);

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/healthz")) return { ok: true, status: 200 };
      return { ok: false, status: 401 };
    });

    await runScanWithTimer(mechaDir, "key");

    expect(readDiscoveredNodes(mechaDir)).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("skips peers where healthz returns non-ok status", async () => {
    mockedScan.mockResolvedValue([
      { ip: "100.64.0.7", hostname: "offline" },
    ]);

    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    await runScanWithTimer(mechaDir, "key");

    expect(readDiscoveredNodes(mechaDir)).toHaveLength(0);
  });

  it("refreshes lastSeen for already-discovered peers still visible", async () => {
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

    await runScanWithTimer(mechaDir, "key");

    const discovered = readDiscoveredNodes(mechaDir);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]!.lastSeen).not.toBe(oldTime);
  });

  it("cleans up expired discovered nodes", async () => {
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

    mockedScan.mockResolvedValue([
      { ip: "100.64.0.21", hostname: "fresh" },
    ]);
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await runScanWithTimer(mechaDir, "key");

    const discovered = readDiscoveredNodes(mechaDir);
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

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("100.64.0.31")) return { ok: false, status: 503 };
      return { ok: true, status: 200 };
    });

    await runScanWithTimer(mechaDir, "key");

    const discovered = readDiscoveredNodes(mechaDir);
    const names = discovered.map((n) => n.name);
    expect(names).toContain("alpha");
    expect(names).not.toContain("beta");
    expect(names).toContain("gamma");
    expect(discovered).toHaveLength(2);
  });

  it("merges mDNS peers with Tailscale peers", async () => {
    // Tailscale returns one peer
    mockedScan.mockResolvedValue([
      { ip: "100.64.0.40", hostname: "ts-peer" },
    ]);

    // mDNS returns a different peer — simulate via the browser emitter
    mockBonjourInstance.find.mockImplementation(() => {
      const browser = new EventEmitter() as EventEmitter & { stop: ReturnType<typeof vi.fn> };
      browser.stop = vi.fn();
      // Emit the mDNS peer asynchronously (before the 3s timeout)
      setTimeout(() => {
        browser.emit("up", {
          addresses: ["192.168.1.50"],
          host: "lan-peer.local",
          port: 7660,
          name: "mecha-lan-peer",
          txt: { nodeName: "lan-peer" },
        });
      }, 10);
      return browser;
    });

    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await runScanWithTimer(mechaDir, "key");

    const discovered = readDiscoveredNodes(mechaDir);
    expect(discovered).toHaveLength(2);
    const names = discovered.map((n) => n.name);
    expect(names).toContain("ts-peer");
    expect(names).toContain("lan-peer");

    // Verify sources
    const tsPeer = discovered.find((n) => n.name === "ts-peer");
    const lanPeer = discovered.find((n) => n.name === "lan-peer");
    expect(tsPeer!.source).toBe("tailscale");
    expect(lanPeer!.source).toBe("mdns");
  });

  it("deduplicates mDNS peers by IP when same IP found via Tailscale", async () => {
    const sharedIp = "100.64.0.50";

    // Same IP from both sources
    mockedScan.mockResolvedValue([
      { ip: sharedIp, hostname: "ts-name" },
    ]);

    mockBonjourInstance.find.mockImplementation(() => {
      const browser = new EventEmitter() as EventEmitter & { stop: ReturnType<typeof vi.fn> };
      browser.stop = vi.fn();
      setTimeout(() => {
        browser.emit("up", {
          addresses: [sharedIp],
          host: "mdns-name.local",
          port: 7660,
          name: "mecha-mdns-name",
          txt: { nodeName: "mdns-name" },
        });
      }, 10);
      return browser;
    });

    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await runScanWithTimer(mechaDir, "key");

    const discovered = readDiscoveredNodes(mechaDir);
    // Only 1 entry — Tailscale wins the dedup
    expect(discovered).toHaveLength(1);
    expect(discovered[0]!.name).toBe("ts-name");
    expect(discovered[0]!.source).toBe("tailscale");
  });

  it("registers mDNS-only peers with correct port", async () => {
    // No Tailscale peers
    mockedScan.mockResolvedValue([]);

    // mDNS peer on a non-default port
    mockBonjourInstance.find.mockImplementation(() => {
      const browser = new EventEmitter() as EventEmitter & { stop: ReturnType<typeof vi.fn> };
      browser.stop = vi.fn();
      setTimeout(() => {
        browser.emit("up", {
          addresses: ["192.168.1.100"],
          host: "custom-port.local",
          port: 7661,
          name: "mecha-custom",
          txt: { nodeName: "custom" },
        });
      }, 10);
      return browser;
    });

    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await runScanWithTimer(mechaDir, "key");

    const discovered = readDiscoveredNodes(mechaDir);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]!.port).toBe(7661);
    expect(discovered[0]!.source).toBe("mdns");
    // Verify fetch used the mDNS-advertised port
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(":7661/healthz"),
      expect.anything(),
    );
  });

  it("filters out self-discovery via local IP matching", async () => {
    // Simulate a local network interface with the same IP as a discovered peer
    mockNetworkInterfaces.mockReturnValue({
      en0: [{ address: "192.168.1.42", internal: false }],
    });

    // Reset find mock to default (no mDNS peers) so only Tailscale peers are tested
    mockBonjourInstance.find.mockReturnValue(mockBrowser);

    mockedScan.mockResolvedValue([
      { ip: "192.168.1.42", hostname: "self-node" },
      { ip: "192.168.1.99", hostname: "remote-node" },
    ]);

    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await runScanWithTimer(mechaDir, "key");

    const discovered = readDiscoveredNodes(mechaDir);
    // Only the remote node should be registered, not ourselves
    expect(discovered).toHaveLength(1);
    expect(discovered[0]!.name).toBe("remote-node");
  });
});

// ── scanMdnsPeers ─────────────────────────────────────────────────

describe("scanMdnsPeers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockBrowser.removeAllListeners();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper: start scan and advance past mDNS browse timeout
  async function scanWithTimer(): Promise<Awaited<ReturnType<typeof scanMdnsPeers>>> {
    const p = scanMdnsPeers();
    await vi.advanceTimersByTimeAsync(MDNS_BROWSE_TIMEOUT_MS + 100);
    return p;
  }

  it("returns peers discovered via mDNS within timeout", async () => {
    mockBonjourInstance.find.mockImplementation(() => {
      const browser = new EventEmitter() as EventEmitter & { stop: ReturnType<typeof vi.fn> };
      browser.stop = vi.fn();
      setTimeout(() => {
        browser.emit("up", {
          addresses: ["192.168.1.10", "fe80::1"],
          host: "peer1.local",
          port: 7660,
          name: "mecha-peer1",
          txt: { nodeName: "peer1" },
        });
        browser.emit("up", {
          addresses: ["192.168.1.11"],
          host: "peer2.local",
          port: 7660,
          name: "mecha-peer2",
          txt: { nodeName: "peer2" },
        });
      }, 10);
      return browser;
    });

    const peers = await scanWithTimer();

    expect(peers).toHaveLength(2);
    // First peer should use IPv4 address (skipping IPv6)
    expect(peers[0]!.ip).toBe("192.168.1.10");
    expect(peers[0]!.hostname).toBe("peer1");
    expect(peers[0]!.port).toBe(7660);
    expect(peers[1]!.ip).toBe("192.168.1.11");
    expect(peers[1]!.hostname).toBe("peer2");
  });

  it("returns empty array when no peers respond", async () => {
    mockBonjourInstance.find.mockImplementation(() => {
      const browser = new EventEmitter() as EventEmitter & { stop: ReturnType<typeof vi.fn> };
      browser.stop = vi.fn();
      // No "up" events emitted
      return browser;
    });

    const peers = await scanWithTimer();

    expect(peers).toHaveLength(0);
  });

  it("falls back to service.name when txt.nodeName is missing", async () => {
    mockBonjourInstance.find.mockImplementation(() => {
      const browser = new EventEmitter() as EventEmitter & { stop: ReturnType<typeof vi.fn> };
      browser.stop = vi.fn();
      setTimeout(() => {
        browser.emit("up", {
          addresses: ["192.168.1.20"],
          host: "unnamed.local",
          port: 7660,
          name: "mecha-my-host",
          txt: {},
        });
      }, 10);
      return browser;
    });

    const peers = await scanWithTimer();

    expect(peers).toHaveLength(1);
    expect(peers[0]!.hostname).toBe("my-host");
  });

  it("resolves early via debounce when peers respond before hard timeout", async () => {
    mockBonjourInstance.find.mockImplementation(() => {
      const browser = new EventEmitter() as EventEmitter & { stop: ReturnType<typeof vi.fn> };
      browser.stop = vi.fn();
      // Emit a peer at 10ms (well before the 3s hard timeout)
      setTimeout(() => {
        browser.emit("up", {
          addresses: ["192.168.1.50"],
          host: "fast-peer.local",
          port: 7660,
          name: "mecha-fast",
          txt: { nodeName: "fast" },
        });
      }, 10);
      return browser;
    });

    const p = scanMdnsPeers();
    // Advance past the peer emit (10ms) + debounce (500ms) but NOT to the hard timeout (3s)
    await vi.advanceTimersByTimeAsync(10 + MDNS_DEBOUNCE_MS + 10);
    const peers = await p;

    expect(peers).toHaveLength(1);
    expect(peers[0]!.hostname).toBe("fast");
  });

  it("exports the correct debounce constant", () => {
    expect(MDNS_DEBOUNCE_MS).toBe(500);
  });

  it("falls back to service.host when no IPv4 address is available", async () => {
    mockBonjourInstance.find.mockImplementation(() => {
      const browser = new EventEmitter() as EventEmitter & { stop: ReturnType<typeof vi.fn> };
      browser.stop = vi.fn();
      setTimeout(() => {
        browser.emit("up", {
          addresses: ["fe80::1"],
          host: "ipv6-only.local",
          port: 7660,
          name: "mecha-ipv6",
          txt: { nodeName: "ipv6" },
        });
      }, 10);
      return browser;
    });

    const peers = await scanWithTimer();

    expect(peers).toHaveLength(1);
    expect(peers[0]!.ip).toBe("ipv6-only.local");
  });
});

// ── startMdnsAdvertise ────────────────────────────────────────────

describe("startMdnsAdvertise", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes an mDNS service and returns a cleanup function", () => {
    const stop = startMdnsAdvertise({
      nodeName: "my-node",
      port: 7660,
      version: "4.1.10",
    });

    expect(mockBonjourInstance.publish).toHaveBeenCalledWith({
      name: "mecha-my-node",
      type: "mecha",
      port: 7660,
      txt: { nodeName: "my-node", version: "4.1.10" },
    });

    // Verify error handler was attached on the published service
    expect(mockPublishedService.on).toHaveBeenCalledWith("error", expect.any(Function));

    // Cleanup should stop the service then destroy bonjour via callback
    stop();
    expect(mockPublishedService.stop).toHaveBeenCalledWith(expect.any(Function));
    // The mock invokes the callback synchronously, so destroy should have been called
    expect(mockBonjourInstance.destroy).toHaveBeenCalled();
  });
});

// ── startDiscoveryLoop ────────────────────────────────────────────

describe("startDiscoveryLoop", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "discovery-loop-test-"));
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockNetworkInterfaces.mockReturnValue({});
    mockBrowser.removeAllListeners();
    mockedScan.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(mechaDir, { recursive: true, force: true });
  });

  // Each scan cycle includes a 3-second mDNS browse timeout that must
  // be advanced for the scan to complete under fake timers.
  const advancePastScan = () => vi.advanceTimersByTimeAsync(MDNS_BROWSE_TIMEOUT_MS + 100);

  it("runs an initial scan immediately", async () => {
    const stop = startDiscoveryLoop(mechaDir, "key");

    // Allow the initial async scan (including mDNS browse timeout) to complete
    await advancePastScan();

    expect(mockedScan).toHaveBeenCalledTimes(1);
    stop();
  });

  it("runs subsequent scans on interval", async () => {
    const stop = startDiscoveryLoop(mechaDir, "key");

    await advancePastScan();
    expect(mockedScan).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
    await advancePastScan();
    expect(mockedScan).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
    await advancePastScan();
    expect(mockedScan).toHaveBeenCalledTimes(3);

    stop();
  });

  it("stops scanning after cleanup function is called", async () => {
    const stop = startDiscoveryLoop(mechaDir, "key");

    await advancePastScan();
    expect(mockedScan).toHaveBeenCalledTimes(1);

    stop();

    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS * 3);
    expect(mockedScan).toHaveBeenCalledTimes(1);
  });

  it("exports the correct scan interval constant", () => {
    expect(SCAN_INTERVAL_MS).toBe(60_000);
  });

  it("exports the correct mDNS browse timeout constant", () => {
    expect(MDNS_BROWSE_TIMEOUT_MS).toBe(3_000);
  });
});
