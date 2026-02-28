import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@mecha/core", () => ({
  getNode: vi.fn(),
  isValidName: vi.fn(),
}));

vi.mock("@/lib/pm-singleton", () => ({
  getMechaDir: vi.fn().mockReturnValue("/fake/.mecha"),
  log: { error: vi.fn() },
}));

vi.mock("@/lib/mesh-proxy", () => ({
  proxyToNode: vi.fn(),
}));

import { getNode, isValidName } from "@mecha/core";
import { proxyToNode } from "@/lib/mesh-proxy";
import { resolveNodeParam, proxyRequest } from "../src/lib/node-dispatch.js";

const mockGetNode = vi.mocked(getNode);
const mockIsValidName = vi.mocked(isValidName);
const mockProxyToNode = vi.mocked(proxyToNode);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveNodeParam", () => {
  it("returns undefined node when no query param", async () => {
    const req = new Request("http://localhost/api/casas");
    const result = await resolveNodeParam(req);
    expect(result).toEqual({ node: undefined });
  });

  it("returns undefined node for node=local", async () => {
    const req = new Request("http://localhost/api/casas?node=local");
    const result = await resolveNodeParam(req);
    expect(result).toEqual({ node: undefined });
  });

  it("returns error for invalid node name", async () => {
    mockIsValidName.mockReturnValue(false);
    const req = new Request("http://localhost/api/casas?node=BAD_NAME");
    const result = await resolveNodeParam(req);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.status).toBe(400);
    }
  });

  it("returns error when node not found", async () => {
    mockIsValidName.mockReturnValue(true);
    mockGetNode.mockReturnValue(undefined);
    const req = new Request("http://localhost/api/casas?node=ghost");
    const result = await resolveNodeParam(req);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.status).toBe(404);
    }
  });

  it("returns node entry for valid remote node", async () => {
    const entry = { name: "bob", host: "10.0.0.1", port: 7660, apiKey: "key", addedAt: "2026-01-01" };
    mockIsValidName.mockReturnValue(true);
    mockGetNode.mockReturnValue(entry);
    const req = new Request("http://localhost/api/casas?node=bob");
    const result = await resolveNodeParam(req);
    expect("node" in result && result.node).toEqual(entry);
  });
});

describe("proxyRequest", () => {
  const node = { name: "bob", host: "10.0.0.1", port: 7660, apiKey: "key", addedAt: "2026-01-01" };

  it("proxies and returns JSON response", async () => {
    mockProxyToNode.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await proxyRequest(node, "POST", "/casas/coder/stop");
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.ok).toBe(true);
  });

  it("returns 502 on proxy error", async () => {
    mockProxyToNode.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await proxyRequest(node, "GET", "/casas/coder/status");
    expect(result.status).toBe(502);
    const body = await result.json();
    expect(body.error).toContain("bob");
  });

  it("handles non-JSON response body", async () => {
    mockProxyToNode.mockResolvedValue(
      new Response("not json", { status: 200 }),
    );

    const result = await proxyRequest(node, "GET", "/healthz");
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.ok).toBe(true);
  });

  it("preserves upstream status code", async () => {
    mockProxyToNode.mockResolvedValue(
      new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await proxyRequest(node, "GET", "/casas/ghost/status");
    expect(result.status).toBe(404);
  });

  it("passes body to proxyToNode", async () => {
    mockProxyToNode.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await proxyRequest(node, "POST", "/casas", { name: "coder" });
    expect(mockProxyToNode).toHaveBeenCalledWith(node, "POST", "/casas", { name: "coder" });
  });
});
