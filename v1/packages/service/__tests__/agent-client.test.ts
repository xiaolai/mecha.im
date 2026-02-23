import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { agentFetch } from "../src/agent-client.js";
import type { NodeEntry } from "../src/agent-client.js";

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const node: NodeEntry = { name: "gpu-server", host: "http://100.64.0.2:7660", key: "secret-key" };

describe("agentFetch", () => {
  it("returns Response on successful GET", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const res = await agentFetch(node, "/mechas");
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("sets Authorization header with Bearer token", async () => {
    mockFetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    await agentFetch(node, "/mechas");
    const [, init] = mockFetch.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer secret-key");
  });

  it("throws NodeUnreachableError on network error", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(agentFetch(node, "/mechas")).rejects.toThrow("Node unreachable: gpu-server");
  });

  it("throws NodeAuthFailedError on 401 response", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
    await expect(agentFetch(node, "/mechas")).rejects.toThrow("Authentication failed for node: gpu-server");
  });

  it("throws NodeRequestFailedError on 500 response", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }));
    await expect(agentFetch(node, "/mechas")).rejects.toThrow("Request to node gpu-server failed with status 500");
  });

  it("auto-adds http:// when host has no protocol", async () => {
    const bareNode: NodeEntry = { name: "bare", host: "100.64.0.5:7660", key: "k" };
    mockFetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    await agentFetch(bareNode, "/healthz");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://100.64.0.5:7660/healthz");
  });

  it("preserves caller-provided headers alongside auth", async () => {
    mockFetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    await agentFetch(node, "/mechas", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    });
    const [, init] = mockFetch.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer secret-key");
  });

  it("omits signal when timeoutMs is 0", async () => {
    mockFetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    await agentFetch(node, "/mechas", { timeoutMs: 0 });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.signal).toBeUndefined();
  });

  it("passes method and body through", async () => {
    mockFetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    await agentFetch(node, "/mechas/mx-foo/sessions/s1/meta", {
      method: "PATCH",
      body: JSON.stringify({ starred: true }),
    });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ starred: true }));
  });
});
