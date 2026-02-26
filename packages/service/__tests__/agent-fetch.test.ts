import { describe, it, expect, vi, afterEach } from "vitest";
import { agentFetch } from "../src/agent-fetch.js";
import type { NodeEntry } from "@mecha/core";

describe("agentFetch", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  const node: NodeEntry = {
    name: "bob",
    host: "203.0.113.10",
    port: 7660,
    apiKey: "secret-key",
    addedAt: "2026-01-01T00:00:00Z",
  };

  it("sends GET with Authorization header", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const res = await agentFetch({ node, path: "/healthz" });

    expect(res).toBeInstanceOf(Response);
    expect(fetch).toHaveBeenCalledWith(
      "http://203.0.113.10:7660/healthz",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer secret-key",
        }),
      }),
    );
  });

  it("rejects private/loopback hosts (SSRF protection)", async () => {
    const privateNode = { ...node, host: "127.0.0.1" };
    await expect(agentFetch({ node: privateNode, path: "/healthz" })).rejects.toThrow("private/loopback");

    const localNode = { ...node, host: "192.168.1.10" };
    await expect(agentFetch({ node: localNode, path: "/healthz" })).rejects.toThrow("private/loopback");
  });

  it("sends POST with JSON body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await agentFetch({ node, path: "/casas/analyst/query", method: "POST", body: { message: "hello" } });

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[1]!.method).toBe("POST");
    expect(call[1]!.body).toBe('{"message":"hello"}');
    expect((call[1]!.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("sets X-Mecha-Source header when source provided", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await agentFetch({ node, path: "/casas/analyst/query", source: "coder@alice" });

    const call = vi.mocked(fetch).mock.calls[0];
    expect((call[1]!.headers as Record<string, string>)["x-mecha-source"]).toBe("coder@alice");
  });

  it("sets X-Mecha-Signature when signFn provided with body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const signFn = vi.fn().mockReturnValue(new Uint8Array([1, 2, 3]));

    await agentFetch({
      node, path: "/query", method: "POST",
      body: { message: "hi" },
      signFn,
    });

    expect(signFn).toHaveBeenCalled();
    const call = vi.mocked(fetch).mock.calls[0];
    const sig = (call[1]!.headers as Record<string, string>)["x-mecha-signature"];
    expect(sig).toBeDefined();
    expect(sig!.length).toBeGreaterThan(0);
  });

  it("does not set signature header without body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const signFn = vi.fn();
    await agentFetch({ node, path: "/healthz", signFn });

    expect(signFn).not.toHaveBeenCalled();
    const call = vi.mocked(fetch).mock.calls[0];
    expect((call[1]!.headers as Record<string, string>)["x-mecha-signature"]).toBeUndefined();
  });

  it("uses custom timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await agentFetch({ node, path: "/healthz", timeoutMs: 5000 });

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[1]!.signal).toBeDefined();
  });
});
