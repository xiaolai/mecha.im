import { describe, it, expect, vi, afterEach } from "vitest";

// Mock @mecha/core before importing
vi.mock("@mecha/core", () => ({
  readNodes: vi.fn(),
  DEFAULTS: { AGENT_STATUS_TIMEOUT_MS: 3000 },
}));

// Mock @mecha/service before importing
vi.mock("@mecha/service", () => ({
  agentFetch: vi.fn(),
}));

import { readNodes } from "@mecha/core";
import { agentFetch } from "@mecha/service";
import type { ProcessManager, ProcessInfo } from "@mecha/process";
import type { CasaName, NodeEntry } from "@mecha/core";
import { proxyToNode, fetchAllNodes, fetchAllCasas } from "../src/lib/mesh-proxy.js";

const mockReadNodes = vi.mocked(readNodes);
const mockAgentFetch = vi.mocked(agentFetch);

function makeNode(name: string, overrides?: Partial<NodeEntry>): NodeEntry {
  return {
    name,
    host: "10.0.0.1",
    port: 7660,
    apiKey: "key",
    addedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePm(list: ProcessInfo[] = []): ProcessManager {
  return {
    list: vi.fn().mockReturnValue(list),
    get: vi.fn(),
    spawn: vi.fn(),
    stop: vi.fn(),
    kill: vi.fn(),
    getPortAndToken: vi.fn(),
  } as unknown as ProcessManager;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("proxyToNode", () => {
  it("forwards request via agentFetch", async () => {
    const node = makeNode("alpha");
    const fakeRes = new Response(JSON.stringify({ ok: true }), { status: 200 });
    mockAgentFetch.mockResolvedValue(fakeRes);

    const result = await proxyToNode(node, "POST", "/casas/coder/stop", { force: true });

    expect(result).toBe(fakeRes);
    expect(mockAgentFetch).toHaveBeenCalledWith({
      node,
      path: "/casas/coder/stop",
      method: "POST",
      body: { force: true },
      timeoutMs: 5_000,
    });
  });

  it("works without body", async () => {
    const node = makeNode("alpha");
    mockAgentFetch.mockResolvedValue(new Response("ok"));

    await proxyToNode(node, "GET", "/healthz");

    expect(mockAgentFetch).toHaveBeenCalledWith(
      expect.objectContaining({ body: undefined }),
    );
  });
});

describe("fetchAllNodes", () => {
  it("returns empty when readNodes throws", async () => {
    mockReadNodes.mockImplementation(() => { throw new Error("no nodes file"); });

    const result = await fetchAllNodes("/fake/.mecha");

    expect(result.nodes).toEqual([]);
  });

  it("returns health status for each node", async () => {
    const nodes = [makeNode("alpha"), makeNode("beta")];
    mockReadNodes.mockReturnValue(nodes);

    mockAgentFetch
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))  // alpha healthz
      .mockResolvedValueOnce(new Response("err", { status: 503 })); // beta healthz

    const result = await fetchAllNodes("/fake/.mecha");

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].name).toBe("alpha");
    expect(result.nodes[0].status).toBe("online");
    expect(typeof result.nodes[0].latencyMs).toBe("number");
    expect(result.nodes[1].name).toBe("beta");
    expect(result.nodes[1].status).toBe("offline");
    expect(result.nodes[1].error).toBe("HTTP 503");
  });

  it("handles node check throwing error", async () => {
    const nodes = [makeNode("alpha")];
    mockReadNodes.mockReturnValue(nodes);

    mockAgentFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await fetchAllNodes("/fake/.mecha");

    expect(result.nodes[0].status).toBe("offline");
    expect(result.nodes[0].error).toBe("ECONNREFUSED");
  });

  it("handles non-Error thrown value", async () => {
    const nodes = [makeNode("alpha")];
    mockReadNodes.mockReturnValue(nodes);

    mockAgentFetch.mockRejectedValue("string error");

    const result = await fetchAllNodes("/fake/.mecha");

    expect(result.nodes[0].status).toBe("offline");
    expect(result.nodes[0].error).toBe("unreachable");
  });
});

describe("fetchAllCasas", () => {
  it("returns local CASAs when readNodes throws", async () => {
    const pm = makePm([
      { name: "coder" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
    ]);
    mockReadNodes.mockImplementation(() => { throw new Error("no nodes"); });

    const result = await fetchAllCasas(pm, "/fake/.mecha");

    expect(result.casas).toHaveLength(1);
    expect(result.casas[0]).toEqual({
      name: "coder",
      node: "local",
      state: "running",
      port: 7700,
      workspacePath: "/ws",
    });
    expect(result.nodeStatus.local.status).toBe("online");
  });

  it("merges local and remote CASAs", async () => {
    const pm = makePm([
      { name: "local-casa" as CasaName, state: "running", port: 7700, workspacePath: "/ws" },
    ]);
    const remoteNode = makeNode("remote-box");
    mockReadNodes.mockReturnValue([remoteNode]);

    // health check → online
    mockAgentFetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    // /casas → list
    mockAgentFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([{ name: "remote-casa", state: "running", port: 7701 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await fetchAllCasas(pm, "/fake/.mecha");

    expect(result.casas).toHaveLength(2);
    expect(result.casas[0].node).toBe("local");
    expect(result.casas[1].node).toBe("remote-box");
    expect(result.casas[1].name).toBe("remote-casa");
    expect(result.nodeStatus["remote-box"].status).toBe("online");
  });

  it("skips offline nodes", async () => {
    const pm = makePm([]);
    const node = makeNode("dead-box");
    mockReadNodes.mockReturnValue([node]);

    mockAgentFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await fetchAllCasas(pm, "/fake/.mecha");

    expect(result.casas).toHaveLength(0);
    expect(result.nodeStatus["dead-box"].status).toBe("offline");
  });

  it("handles /casas fetch failure gracefully", async () => {
    const pm = makePm([]);
    const node = makeNode("flaky-box");
    mockReadNodes.mockReturnValue([node]);

    // health check → online
    mockAgentFetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    // /casas → error
    mockAgentFetch.mockRejectedValueOnce(new Error("timeout"));

    const result = await fetchAllCasas(pm, "/fake/.mecha");

    expect(result.casas).toHaveLength(0);
    expect(result.nodeStatus["flaky-box"].status).toBe("online");
  });

  it("handles /casas non-ok response", async () => {
    const pm = makePm([]);
    const node = makeNode("err-box");
    mockReadNodes.mockReturnValue([node]);

    // health → ok
    mockAgentFetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    // /casas → 500
    mockAgentFetch.mockResolvedValueOnce(new Response("err", { status: 500 }));

    const result = await fetchAllCasas(pm, "/fake/.mecha");

    expect(result.casas).toHaveLength(0);
    expect(result.nodeStatus["err-box"].status).toBe("online");
  });

  it("always includes local node status as online", async () => {
    const pm = makePm([]);
    mockReadNodes.mockReturnValue([]);

    const result = await fetchAllCasas(pm, "/fake/.mecha");

    expect(result.nodeStatus.local).toEqual({ name: "local", status: "online" });
  });
});
