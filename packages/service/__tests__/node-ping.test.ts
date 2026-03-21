import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@mecha/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/core")>();
  return { ...actual, getNode: vi.fn() };
});

import { getNode, NodeNotFoundError } from "@mecha/core";
import { nodePing } from "../src/node-ping.js";

const mockGetNode = vi.mocked(getNode);

afterEach(() => {
  vi.restoreAllMocks();
});

const httpNode = {
  name: "test-node",
  host: "10.0.0.1",
  port: 7660,
  apiKey: "k",
  addedAt: new Date().toISOString(),
};

const managedNode = {
  name: "managed-node",
  host: "",
  port: 0,
  managed: true,
  apiKey: "k",
  publicKey: "pk",
  fingerprint: "fp",
  addedAt: new Date().toISOString(),
};

describe("nodePing", () => {
  it("returns latency for reachable HTTP node", async () => {
    mockGetNode.mockReturnValue(httpNode);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );

    const result = await nodePing("/tmp/mecha", "test-node");
    expect(result.reachable).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.method).toBe("http");
  });

  it("returns reachable=false when HTTP node is unreachable", async () => {
    mockGetNode.mockReturnValue(httpNode);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("connection refused"),
    );

    const result = await nodePing("/tmp/mecha", "test-node");
    expect(result.reachable).toBe(false);
    expect(result.error).toBe("unreachable");
    expect(result.method).toBe("http");
  });

  it("returns error for non-200 HTTP response", async () => {
    mockGetNode.mockReturnValue(httpNode);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("error", { status: 503 }),
    );

    const result = await nodePing("/tmp/mecha", "test-node");
    expect(result.reachable).toBe(false);
    expect(result.error).toBe("HTTP 503");
    expect(result.method).toBe("http");
  });

  it("uses rendezvous lookup for managed nodes", async () => {
    mockGetNode.mockReturnValue(managedNode);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ online: true }), { status: 200 }),
    );

    const result = await nodePing("/tmp/mecha", "managed-node");
    expect(result.method).toBe("rendezvous");
    expect(result.reachable).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns offline for managed node with online=false", async () => {
    mockGetNode.mockReturnValue(managedNode);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ online: false }), { status: 200 }),
    );

    const result = await nodePing("/tmp/mecha", "managed-node");
    expect(result.reachable).toBe(false);
    expect(result.error).toBe("offline");
    expect(result.method).toBe("rendezvous");
  });

  it("returns offline for managed node with 404", async () => {
    mockGetNode.mockReturnValue(managedNode);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not found", { status: 404 }),
    );

    const result = await nodePing("/tmp/mecha", "managed-node");
    expect(result.reachable).toBe(false);
    expect(result.error).toBe("offline");
  });

  it("returns error for rendezvous non-404 failure", async () => {
    mockGetNode.mockReturnValue(managedNode);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("error", { status: 500 }),
    );

    const result = await nodePing("/tmp/mecha", "managed-node");
    expect(result.reachable).toBe(false);
    expect(result.error).toBe("HTTP 500");
  });

  it("returns unreachable when rendezvous server is down", async () => {
    mockGetNode.mockReturnValue(managedNode);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("network error"),
    );

    const result = await nodePing("/tmp/mecha", "managed-node");
    expect(result.reachable).toBe(false);
    expect(result.error).toBe("unreachable");
  });

  it("throws NodeNotFoundError for unknown node", async () => {
    mockGetNode.mockReturnValue(undefined);
    await expect(nodePing("/tmp/mecha", "nonexistent")).rejects.toThrow(
      NodeNotFoundError,
    );
  });

  it("accepts custom rendezvous server URL", async () => {
    mockGetNode.mockReturnValue(managedNode);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ online: true }), { status: 200 }),
    );

    await nodePing("/tmp/mecha", "managed-node", {
      server: "wss://custom.example.com",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://custom.example.com/lookup/managed-node",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
