import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readDiscoveredNodes } from "@mecha/core";
import { probeCandidates } from "../src/discovery-loop.js";

describe("probeCandidates", () => {
  let mechaDir: string;

  beforeEach(() => { mechaDir = mkdtempSync(join(tmpdir(), "mecha-dl-")); });
  afterEach(() => { rmSync(mechaDir, { recursive: true, force: true }); });

  it("registers a peer that responds to handshake", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", node: "bob" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accepted: true,
        nodeName: "bob",
        port: 7660,
        meshApiKey: "bob-key",
      })));

    await probeCandidates({
      candidates: [{ ip: "100.100.1.9", port: 7660, source: "tailscale" as const }],
      clusterKey: "test-key",
      nodeName: "alice",
      port: 7660,
      mechaDir,
      fetchFn: fetchMock,
    });

    const nodes = readDiscoveredNodes(mechaDir);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.name).toBe("bob");
    expect(nodes[0]!.apiKey).toBe("bob-key");
  });

  it("skips candidates that fail healthz", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("timeout"));

    await probeCandidates({
      candidates: [{ ip: "100.100.1.99", port: 7660, source: "tailscale" as const }],
      clusterKey: "test-key",
      nodeName: "alice",
      port: 7660,
      mechaDir,
      fetchFn: fetchMock,
    });

    expect(readDiscoveredNodes(mechaDir)).toHaveLength(0);
  });

  it("skips candidates where handshake returns 403", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", node: "eve" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));

    await probeCandidates({
      candidates: [{ ip: "100.100.1.50", port: 7660, source: "tailscale" as const }],
      clusterKey: "wrong-key",
      nodeName: "alice",
      port: 7660,
      mechaDir,
      fetchFn: fetchMock,
    });

    expect(readDiscoveredNodes(mechaDir)).toHaveLength(0);
  });
});
