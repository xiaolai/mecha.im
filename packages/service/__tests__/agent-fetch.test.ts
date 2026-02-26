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

  it("rejects managed node without channel (Phase 6)", async () => {
    const managedNode: NodeEntry = {
      ...node,
      host: "", port: 0, apiKey: "",
      managed: true,
    };

    await expect(agentFetch({ node: managedNode, path: "/healthz" }))
      .rejects.toThrow("requires SecureChannel");
  });

  it("allows private hosts when allowPrivateHosts is true", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    const privateNode = { ...node, host: "192.168.1.10" };
    const res = await agentFetch({ node: privateNode, path: "/healthz", allowPrivateHosts: true });
    expect(res).toBeInstanceOf(Response);
  });

  it("uses channel with source header", async () => {
    const sentData: Uint8Array[] = [];
    const messageHandlers: Array<(data: Uint8Array) => void> = [];

    const channel = {
      isOpen: true,
      send: vi.fn((data: Uint8Array) => { sentData.push(data); }),
      onMessage: vi.fn((handler: (data: Uint8Array) => void) => { messageHandlers.push(handler); }),
      offMessage: vi.fn(),
    };

    const promise = agentFetch({
      node, path: "/query", method: "POST", body: { msg: "hi" }, source: "coder@alice", channel,
    });

    await new Promise((r) => setTimeout(r, 10));

    const sentStr = new TextDecoder().decode(sentData[0]!);
    const sentReq = JSON.parse(sentStr) as { id: string; headers: Record<string, string>; body: string };

    // Verify source header and body are passed
    expect(sentReq.headers["x-mecha-source"]).toBe("coder@alice");
    expect(sentReq.body).toBe('{"msg":"hi"}');

    const response = JSON.stringify({ id: sentReq.id, status: 200, headers: {}, body: "ok" });
    for (const h of messageHandlers) h(new TextEncoder().encode(response));

    const res = await promise;
    expect(res.status).toBe(200);
  });

  it("channel fetch times out", async () => {
    const channel = {
      isOpen: true,
      send: vi.fn(),
      onMessage: vi.fn(),
      offMessage: vi.fn(),
    };

    const promise = agentFetch({
      node, path: "/slow", channel, timeoutMs: 50,
    });

    await expect(promise).rejects.toThrow("timeout");
  });

  it("channel fetch returns null body when response has no body", async () => {
    const sentData: Uint8Array[] = [];
    const messageHandlers: Array<(data: Uint8Array) => void> = [];

    const channel = {
      isOpen: true,
      send: vi.fn((data: Uint8Array) => { sentData.push(data); }),
      onMessage: vi.fn((handler: (data: Uint8Array) => void) => { messageHandlers.push(handler); }),
      offMessage: vi.fn(),
    };

    const promise = agentFetch({ node, path: "/healthz", channel });

    await new Promise((r) => setTimeout(r, 10));

    const sentStr = new TextDecoder().decode(sentData[0]!);
    const sentReq = JSON.parse(sentStr) as { id: string };

    // Response without body field
    const response = JSON.stringify({ id: sentReq.id, status: 204, headers: {} });
    for (const h of messageHandlers) h(new TextEncoder().encode(response));

    const res = await promise;
    expect(res.status).toBe(204);
  });

  it("ignores channel responses with wrong ID", async () => {
    const sentData: Uint8Array[] = [];
    const messageHandlers: Array<(data: Uint8Array) => void> = [];

    const channel = {
      isOpen: true,
      send: vi.fn((data: Uint8Array) => { sentData.push(data); }),
      onMessage: vi.fn((handler: (data: Uint8Array) => void) => { messageHandlers.push(handler); }),
      offMessage: vi.fn(),
    };

    const promise = agentFetch({ node, path: "/healthz", channel });

    await new Promise((r) => setTimeout(r, 10));

    const sentStr = new TextDecoder().decode(sentData[0]!);
    const sentReq = JSON.parse(sentStr) as { id: string };

    // Wrong ID — should be ignored
    const wrongResponse = JSON.stringify({ id: "wrong-id", status: 200, headers: {} });
    for (const h of messageHandlers) h(new TextEncoder().encode(wrongResponse));

    // Correct ID — should resolve
    const correctResponse = JSON.stringify({ id: sentReq.id, status: 200, headers: {}, body: "ok" });
    for (const h of messageHandlers) h(new TextEncoder().encode(correctResponse));

    const res = await promise;
    expect(res.status).toBe(200);
  });

  it("uses channel when provided (Phase 6)", async () => {
    const sentData: Uint8Array[] = [];
    const messageHandlers: Array<(data: Uint8Array) => void> = [];

    const channel = {
      isOpen: true,
      send: vi.fn((data: Uint8Array) => { sentData.push(data); }),
      onMessage: vi.fn((handler: (data: Uint8Array) => void) => { messageHandlers.push(handler); }),
      offMessage: vi.fn(),
    };

    const promise = agentFetch({
      node, path: "/healthz", channel,
    });

    // Wait for send
    await new Promise((r) => setTimeout(r, 10));

    // Parse what was sent to get the request ID
    const sentStr = new TextDecoder().decode(sentData[0]!);
    const sentReq = JSON.parse(sentStr) as { id: string };

    // Respond with matching ID
    const response = JSON.stringify({ id: sentReq.id, status: 200, headers: {}, body: "ok" });
    for (const h of messageHandlers) h(new TextEncoder().encode(response));

    const res = await promise;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});
