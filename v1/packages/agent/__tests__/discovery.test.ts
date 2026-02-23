import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

vi.mock("node:util", () => ({
  promisify: (fn: unknown) => fn,
}));

// Mock global fetch for probeMechaAgent
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { discoverTailscalePeers, probeMechaAgent, discoverMechaNodes } = await import("../src/discovery.js");

describe("discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("discoverTailscalePeers", () => {
    it("parses online peers from tailscale status --json", async () => {
      const tsOutput = {
        Peer: {
          "key1": { HostName: "machine-a", DNSName: "machine-a.ts.net.", TailscaleIPs: ["100.64.0.1"], Online: true, OS: "linux" },
          "key2": { HostName: "machine-b", DNSName: "machine-b.ts.net.", TailscaleIPs: ["100.64.0.2"], Online: false, OS: "linux" },
          "key3": { HostName: "machine-c", DNSName: "machine-c.ts.net.", TailscaleIPs: ["100.64.0.3"], Online: true, OS: "darwin" },
        },
      };
      mockExecFile.mockResolvedValue({ stdout: JSON.stringify(tsOutput) });

      const peers = await discoverTailscalePeers();
      expect(peers).toHaveLength(2);
      expect(peers[0]!.HostName).toBe("machine-a");
      expect(peers[1]!.HostName).toBe("machine-c");
    });

    it("returns empty array when no peers exist", async () => {
      mockExecFile.mockResolvedValue({ stdout: JSON.stringify({}) });
      const peers = await discoverTailscalePeers();
      expect(peers).toEqual([]);
    });
  });

  describe("probeMechaAgent", () => {
    it("returns ok true when agent responds", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ status: "ok", node: "machine-a" }),
      });
      const result = await probeMechaAgent("100.64.0.1", 7660);
      expect(result).toEqual({ ok: true, node: "machine-a" });
    });

    it("returns ok false when agent returns non-ok status", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ status: "error" }),
      });
      const result = await probeMechaAgent("100.64.0.1");
      expect(result).toEqual({ ok: false, node: undefined });
    });

    it("returns ok false when HTTP request fails", async () => {
      mockFetch.mockResolvedValue({ ok: false });
      const result = await probeMechaAgent("100.64.0.1");
      expect(result).toEqual({ ok: false });
    });

    it("returns ok false when fetch throws (network error)", async () => {
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
      const result = await probeMechaAgent("100.64.0.1");
      expect(result).toEqual({ ok: false });
    });
  });

  describe("discoverMechaNodes", () => {
    it("discovers and probes peers, returns responding nodes", async () => {
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          Peer: {
            k1: { HostName: "a", DNSName: "a.ts.", TailscaleIPs: ["10.0.0.1"], Online: true, OS: "linux" },
            k2: { HostName: "b", DNSName: "b.ts.", TailscaleIPs: ["10.0.0.2"], Online: true, OS: "linux" },
          },
        }),
      });

      // First peer responds, second doesn't
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ok", node: "a" }) })
        .mockResolvedValueOnce({ ok: false });

      const nodes = await discoverMechaNodes({ port: 7660 });
      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toEqual({ name: "a", host: "10.0.0.1:7660", key: "" });
    });

    it("skips peers with no IP addresses", async () => {
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          Peer: {
            k1: { HostName: "no-ip", DNSName: "no.ts.", TailscaleIPs: [], Online: true, OS: "linux" },
          },
        }),
      });

      const nodes = await discoverMechaNodes();
      expect(nodes).toEqual([]);
    });
  });
});
