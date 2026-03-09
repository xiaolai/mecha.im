import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeCtx, callTool, getText } from "../test-helpers.js";

vi.mock("@mecha/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/core")>();
  return {
    ...actual,
    readBotConfig: vi.fn().mockReturnValue({ tags: [], expose: [] }),
  };
});

import { readBotConfig } from "@mecha/core";

describe("mecha_list_nodes", () => {
  it("returns message when no nodes registered", async () => {
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_list_nodes", {});
    expect(getText(result)).toContain("No mesh nodes");
  });

  it("health-checks unmanaged nodes", async () => {
    const ctx = makeCtx({
      getNodes: vi.fn().mockReturnValue([
        { name: "peer1", host: "192.168.1.10", port: 7660, apiKey: "k1", addedAt: "2026-01-01" },
      ]),
      agentFetch: vi.fn().mockResolvedValue({ ok: true, status: 200 }) as never,
    });

    const result = await callTool(ctx, "mecha_list_nodes", {});
    expect(getText(result)).toContain("peer1");
    expect(getText(result)).toContain("healthy");
  });

  it("shows managed nodes as p2p", async () => {
    const ctx = makeCtx({
      getNodes: vi.fn().mockReturnValue([
        { name: "peer2", host: "p2p", port: 0, apiKey: "k2", addedAt: "2026-01-01", managed: true, publicKey: "pk", fingerprint: "fp" },
      ]),
    });

    const result = await callTool(ctx, "mecha_list_nodes", {});
    expect(getText(result)).toContain("peer2");
    expect(getText(result)).toContain("p2p");
  });

  it("shows unhealthy nodes (non-ok response)", async () => {
    const ctx = makeCtx({
      getNodes: vi.fn().mockReturnValue([
        { name: "peer4", host: "10.0.0.2", port: 7660, apiKey: "k4", addedAt: "2026-01-01" },
      ]),
      agentFetch: vi.fn().mockResolvedValue({ ok: false, status: 503 }) as never,
    });

    const result = await callTool(ctx, "mecha_list_nodes", {});
    expect(getText(result)).toContain("peer4");
    expect(getText(result)).toContain("unreachable");
  });

  it("handles health-check failures gracefully", async () => {
    const ctx = makeCtx({
      getNodes: vi.fn().mockReturnValue([
        { name: "peer3", host: "10.0.0.1", port: 7660, apiKey: "k3", addedAt: "2026-01-01" },
      ]),
      agentFetch: vi.fn().mockRejectedValue(new Error("timeout")) as never,
    });

    const result = await callTool(ctx, "mecha_list_nodes", {});
    expect(getText(result)).toContain("peer3");
    expect(getText(result)).toContain("unreachable");
  });
});

describe("mecha_list_bots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (readBotConfig as ReturnType<typeof vi.fn>).mockReturnValue({ tags: [], expose: [] });
  });

  it("returns message when no bots found", async () => {
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_list_bots", {});
    expect(getText(result)).toContain("No bots found");
  });

  it("lists local bots with tags", async () => {
    const pm = {
      get: vi.fn(),
      list: vi.fn().mockReturnValue([
        { name: "alice", state: "running", port: 7700, workspacePath: "/home/user/alice" },
        { name: "bob", state: "stopped", workspacePath: "/home/user/bob" },
      ]),
      getPortAndToken: vi.fn(),
    };
    (readBotConfig as ReturnType<typeof vi.fn>).mockImplementation((dir: string) => {
      if (dir.includes("alice")) return { tags: ["research"] };
      return { tags: [] };
    });
    const ctx = makeCtx({ pm: pm as never });

    const result = await callTool(ctx, "mecha_list_bots", {});
    const text = getText(result);
    expect(text).toContain("alice");
    expect(text).toContain("running");
    expect(text).toContain("research");
    expect(text).toContain("bob");
    expect(text).toContain("stopped");
  });

  it("respects limit", async () => {
    const pm = {
      get: vi.fn(),
      list: vi.fn().mockReturnValue([
        { name: "a", state: "running", port: 7700, workspacePath: "/a" },
        { name: "b", state: "running", port: 7701, workspacePath: "/b" },
        { name: "c", state: "running", port: 7702, workspacePath: "/c" },
      ]),
      getPortAndToken: vi.fn(),
    };
    const ctx = makeCtx({ pm: pm as never });

    const result = await callTool(ctx, "mecha_list_bots", { limit: 2 });
    const text = getText(result);
    expect(text).toContain("a:");
    expect(text).toContain("b:");
    expect(text).not.toContain("c:");
  });

  it("errors on unknown remote node", async () => {
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_list_bots", { node: "unknown" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("Node not found");
  });

  it("queries remote node", async () => {
    const mockAgentFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([{ name: "remote-bot", state: "running", port: 7700 }]),
    });
    const ctx = makeCtx({
      getNodes: vi.fn().mockReturnValue([
        { name: "peer1", host: "192.168.1.10", port: 7660, apiKey: "k1", addedAt: "2026-01-01" },
      ]),
      agentFetch: mockAgentFetch as never,
    });

    const result = await callTool(ctx, "mecha_list_bots", { node: "peer1" });
    const text = getText(result);
    expect(text).toContain("remote-bot");
    expect(text).toContain("peer1");
  });

  it("includes source header in remote agentFetch calls", async () => {
    const mockAgentFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([{ name: "bot-a", state: "running" }]),
    });
    const ctx = makeCtx({
      getNodes: vi.fn().mockReturnValue([
        { name: "peer1", host: "192.168.1.10", port: 7660, apiKey: "k1", addedAt: "2026-01-01" },
      ]),
      agentFetch: mockAgentFetch as never,
      clientInfo: { name: "claude-desktop", version: "1.0" },
    });

    await callTool(ctx, "mecha_list_bots", { node: "peer1" });
    expect(mockAgentFetch).toHaveBeenCalledWith(
      expect.objectContaining({ source: "mcp:claude-desktop" }),
    );
  });

  it("lists remote bots without port", async () => {
    const ctx = makeCtx({
      getNodes: vi.fn().mockReturnValue([
        { name: "peer1", host: "192.168.1.10", port: 7660, apiKey: "k1", addedAt: "2026-01-01" },
      ]),
      agentFetch: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([{ name: "remote-bot", state: "stopped" }]),
      }) as never,
    });

    const result = await callTool(ctx, "mecha_list_bots", { node: "peer1" });
    const text = getText(result);
    expect(text).toContain("remote-bot: stopped");
    expect(text).not.toContain("port");
  });

  it("limits remote bots", async () => {
    const ctx = makeCtx({
      getNodes: vi.fn().mockReturnValue([
        { name: "peer1", host: "192.168.1.10", port: 7660, apiKey: "k1", addedAt: "2026-01-01" },
      ]),
      agentFetch: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          { name: "a", state: "running" },
          { name: "b", state: "running" },
          { name: "c", state: "running" },
        ]),
      }) as never,
    });

    const result = await callTool(ctx, "mecha_list_bots", { node: "peer1", limit: 2 });
    const text = getText(result);
    expect(text).toContain("a:");
    expect(text).toContain("b:");
    expect(text).not.toContain("c:");
  });

  it("rejects managed node remote listing", async () => {
    const ctx = makeCtx({
      getNodes: vi.fn().mockReturnValue([
        { name: "peer2", host: "p2p", port: 0, apiKey: "k2", addedAt: "2026-01-01", managed: true, publicKey: "pk", fingerprint: "fp" },
      ]),
    });

    const result = await callTool(ctx, "mecha_list_bots", { node: "peer2" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("Managed");
  });

  it("handles remote fetch failure", async () => {
    const ctx = makeCtx({
      getNodes: vi.fn().mockReturnValue([
        { name: "peer1", host: "192.168.1.10", port: 7660, apiKey: "k1", addedAt: "2026-01-01" },
      ]),
      agentFetch: vi.fn().mockRejectedValue(new Error("network error")) as never,
    });

    const result = await callTool(ctx, "mecha_list_bots", { node: "peer1" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("network error");
  });
});

describe("mecha_bot_status", () => {
  it("returns local bot status", async () => {
    const pm = {
      get: vi.fn().mockReturnValue({
        name: "alice", state: "running", pid: 1234, port: 7700, workspacePath: "/home/user/alice",
      }),
      list: vi.fn().mockReturnValue([]),
      getPortAndToken: vi.fn(),
    };
    const ctx = makeCtx({ pm: pm as never });

    const result = await callTool(ctx, "mecha_bot_status", { target: "alice" });
    const text = getText(result);
    expect(text).toContain("alice");
    expect(text).toContain("running");
    expect(text).toContain("1234");
    expect(text).toContain("7700");
  });

  it("errors on unknown local bot", async () => {
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_bot_status", { target: "unknown" });
    expect(result.isError).toBe(true);
  });

  it("queries remote bot via name@node", async () => {
    const mockAgentFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ name: "alice", state: "running", port: 7700 }),
    });
    const ctx = makeCtx({
      getNodes: vi.fn().mockReturnValue([
        { name: "peer1", host: "192.168.1.10", port: 7660, apiKey: "k1", addedAt: "2026-01-01" },
      ]),
      agentFetch: mockAgentFetch as never,
      clientInfo: { name: "cursor", version: "2.0" },
    });

    const result = await callTool(ctx, "mecha_bot_status", { target: "alice@peer1" });
    const text = getText(result);
    expect(text).toContain("alice");
    expect(text).toContain("running");
    expect(mockAgentFetch).toHaveBeenCalledWith(
      expect.objectContaining({ source: "mcp:cursor" }),
    );
  });

  it("errors on unknown remote node", async () => {
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_bot_status", { target: "alice@unknown" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("Node not found");
  });

  it("rejects managed remote node", async () => {
    const ctx = makeCtx({
      getNodes: vi.fn().mockReturnValue([
        { name: "peer2", host: "p2p", port: 0, apiKey: "k2", addedAt: "2026-01-01", managed: true, publicKey: "pk", fingerprint: "fp" },
      ]),
    });

    const result = await callTool(ctx, "mecha_bot_status", { target: "alice@peer2" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("Managed");
  });
});

describe("mecha_discover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (readBotConfig as ReturnType<typeof vi.fn>).mockReturnValue({ tags: [], expose: [] });
  });

  it("returns message when no bots match", async () => {
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_discover", {});
    expect(getText(result)).toContain("No bots match");
  });

  it("filters by tag", async () => {
    const pm = {
      get: vi.fn(),
      list: vi.fn().mockReturnValue([
        { name: "alice", state: "running", port: 7700, workspacePath: "/a" },
        { name: "bob", state: "running", port: 7701, workspacePath: "/b" },
      ]),
      getPortAndToken: vi.fn(),
    };
    (readBotConfig as ReturnType<typeof vi.fn>).mockImplementation((dir: string) => {
      if (dir.includes("alice")) return { tags: ["research"], expose: [] };
      return { tags: ["coding"], expose: [] };
    });
    const ctx = makeCtx({ pm: pm as never });

    const result = await callTool(ctx, "mecha_discover", { tag: "research" });
    const text = getText(result);
    expect(text).toContain("alice");
    expect(text).not.toContain("bob");
  });

  it("filters by capability", async () => {
    const pm = {
      get: vi.fn(),
      list: vi.fn().mockReturnValue([
        { name: "alice", state: "running", port: 7700, workspacePath: "/a" },
        { name: "bob", state: "running", port: 7701, workspacePath: "/b" },
      ]),
      getPortAndToken: vi.fn(),
    };
    (readBotConfig as ReturnType<typeof vi.fn>).mockImplementation((dir: string) => {
      if (dir.includes("alice")) return { tags: [], expose: ["query"] };
      return { tags: [], expose: [] };
    });
    const ctx = makeCtx({ pm: pm as never });

    const result = await callTool(ctx, "mecha_discover", { capability: "query" });
    const text = getText(result);
    expect(text).toContain("alice");
    expect(text).not.toContain("bob");
  });

  it("respects limit", async () => {
    const pm = {
      get: vi.fn(),
      list: vi.fn().mockReturnValue([
        { name: "a", state: "running", port: 7700, workspacePath: "/a" },
        { name: "b", state: "running", port: 7701, workspacePath: "/b" },
        { name: "c", state: "running", port: 7702, workspacePath: "/c" },
      ]),
      getPortAndToken: vi.fn(),
    };
    const ctx = makeCtx({ pm: pm as never });

    const result = await callTool(ctx, "mecha_discover", { limit: 2 });
    const text = getText(result);
    expect(text).toContain("a:");
    expect(text).toContain("b:");
    expect(text).not.toContain("c:");
  });
});
