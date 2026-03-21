import { describe, it, expect, vi, afterEach } from "vitest";
import { hostname, platform, arch } from "node:os";

// Mock node:os so we can control networkInterfaces
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    networkInterfaces: vi.fn().mockReturnValue(actual.networkInterfaces()),
  };
});

import { getNetworkIps, collectNodeInfo, formatUptime, wsToHttp, fetchPublicIp } from "../src/node-info.js";
import { networkInterfaces } from "node:os";

const mockNetworkInterfaces = networkInterfaces as ReturnType<typeof vi.fn>;

describe("getNetworkIps", () => {
  afterEach(() => vi.restoreAllMocks());

  it("detects LAN and Tailscale IPs from network interfaces", () => {
    mockNetworkInterfaces.mockReturnValue({
      en0: [
        { address: "10.0.0.125", family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: "10.0.0.125/24" },
      ],
      utun3: [
        { address: "100.100.1.1", family: "IPv4", internal: false, netmask: "255.255.255.255", mac: "00:00:00:00:00:00", cidr: "100.100.1.1/32" },
      ],
    });

    const result = getNetworkIps();
    expect(result.lanIp).toBe("10.0.0.125");
    expect(result.tailscaleIp).toBe("100.100.1.1");
  });

  it("detects 192.168.x LAN range", () => {
    mockNetworkInterfaces.mockReturnValue({
      en0: [
        { address: "192.168.1.50", family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: "192.168.1.50/24" },
      ],
    });

    const result = getNetworkIps();
    expect(result.lanIp).toBe("192.168.1.50");
  });

  it("detects 172.16-31.x LAN range", () => {
    mockNetworkInterfaces.mockReturnValue({
      en0: [
        { address: "172.20.0.5", family: "IPv4", internal: false, netmask: "255.255.0.0", mac: "00:00:00:00:00:00", cidr: "172.20.0.5/16" },
      ],
    });

    const result = getNetworkIps();
    expect(result.lanIp).toBe("172.20.0.5");
  });

  it("skips IPv6 and internal addresses", () => {
    mockNetworkInterfaces.mockReturnValue({
      lo0: [
        { address: "127.0.0.1", family: "IPv4", internal: true, netmask: "255.0.0.0", mac: "00:00:00:00:00:00", cidr: "127.0.0.1/8" },
      ],
      en0: [
        { address: "fe80::1", family: "IPv6", internal: false, netmask: "ffff:ffff:ffff:ffff::", mac: "00:00:00:00:00:00", cidr: "fe80::1/64", scopeid: 0 },
      ],
    });

    const result = getNetworkIps();
    expect(result.lanIp).toBeUndefined();
    expect(result.tailscaleIp).toBeUndefined();
  });

  it("returns undefined when no interfaces match", () => {
    mockNetworkInterfaces.mockReturnValue({});
    const result = getNetworkIps();
    expect(result.lanIp).toBeUndefined();
    expect(result.tailscaleIp).toBeUndefined();
  });

  it("handles undefined interface entries", () => {
    mockNetworkInterfaces.mockReturnValue({ en0: undefined });
    const result = getNetworkIps();
    expect(result.lanIp).toBeUndefined();
  });

  it("picks first matching LAN IP only", () => {
    mockNetworkInterfaces.mockReturnValue({
      en0: [
        { address: "10.0.0.1", family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: "10.0.0.1/24" },
        { address: "10.0.0.2", family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: "10.0.0.2/24" },
      ],
    });

    const result = getNetworkIps();
    expect(result.lanIp).toBe("10.0.0.1");
  });

  it("does not classify public IPs as LAN", () => {
    mockNetworkInterfaces.mockReturnValue({
      en0: [
        { address: "203.0.113.42", family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: "203.0.113.42/24" },
      ],
    });

    const result = getNetworkIps();
    expect(result.lanIp).toBeUndefined();
    expect(result.tailscaleIp).toBeUndefined();
  });
});

describe("collectNodeInfo", () => {
  it("assembles node info from system data", () => {
    const info = collectNodeInfo({
      port: 7660,
      startedAt: "2026-03-02T12:00:00.000Z",
      botCount: 3,
      publicIp: "203.0.113.42",
    });

    expect(info.hostname).toBe(hostname());
    expect(info.platform).toBe(platform());
    expect(info.arch).toBe(arch());
    expect(info.port).toBe(7660);
    expect(info.startedAt).toBe("2026-03-02T12:00:00.000Z");
    expect(info.botCount).toBe(3);
    expect(info.publicIp).toBe("203.0.113.42");
    expect(info.totalMemMB).toBeGreaterThan(0);
    expect(info.freeMemMB).toBeGreaterThanOrEqual(0);
    expect(info.cpuCount).toBeGreaterThan(0);
    expect(info.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("works without publicIp", () => {
    const info = collectNodeInfo({
      port: 7660,
      startedAt: "2026-03-02T12:00:00.000Z",
      botCount: 0,
    });

    expect(info.publicIp).toBeUndefined();
  });
});

describe("formatUptime", () => {
  it("formats 0 seconds", () => {
    expect(formatUptime(0)).toBe("0m");
  });

  it("formats minutes only", () => {
    expect(formatUptime(2700)).toBe("45m");
  });

  it("formats hours and minutes", () => {
    expect(formatUptime(8100)).toBe("2h 15m");
  });

  it("formats days and hours", () => {
    expect(formatUptime(277200)).toBe("3d 5h");
  });

  it("formats exactly one hour", () => {
    expect(formatUptime(3600)).toBe("1h 0m");
  });

  it("formats exactly one day", () => {
    expect(formatUptime(86400)).toBe("1d 0h");
  });
});

describe("wsToHttp", () => {
  it("converts ws:// to http://", () => {
    expect(wsToHttp("ws://localhost:7681")).toBe("http://localhost:7681");
  });

  it("converts wss:// to https://", () => {
    expect(wsToHttp("wss://rendezvous.mecha.im")).toBe("https://rendezvous.mecha.im");
  });

  it("leaves http:// URLs unchanged", () => {
    expect(wsToHttp("http://example.com")).toBe("http://example.com");
  });
});

describe("fetchPublicIp", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns trimmed IP on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("  203.0.113.42\n", { status: 200 }),
    );
    const ip = await fetchPublicIp();
    expect(ip).toBe("203.0.113.42");
  });

  it("returns undefined on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 500 }),
    );
    const ip = await fetchPublicIp();
    expect(ip).toBeUndefined();
  });

  it("returns undefined on empty response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 200 }),
    );
    const ip = await fetchPublicIp();
    expect(ip).toBeUndefined();
  });

  it("returns undefined on fetch error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));
    const ip = await fetchPublicIp();
    expect(ip).toBeUndefined();
  });
});
