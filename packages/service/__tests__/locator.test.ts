import { describe, it, expect, vi, beforeEach } from "vitest";
import { MechaLocator } from "../src/locator.js";
import type { DockerClient } from "@mecha/docker";
import type { NodeEntry } from "../src/agent-client.js";
import { NodeUnreachableError } from "@mecha/contracts";

const mockMechaLs = vi.fn();
vi.mock("../src/inspect.js", () => ({
  mechaLs: (...args: unknown[]) => mockMechaLs(...args),
}));

const mockAgentFetch = vi.fn();
vi.mock("../src/agent-client.js", () => ({
  agentFetch: (...args: unknown[]) => mockAgentFetch(...args),
}));

const client = {} as DockerClient;
const nodeA: NodeEntry = { name: "gpu", host: "http://100.64.0.2:7660", key: "k1" };
const nodeB: NodeEntry = { name: "work", host: "http://100.64.0.3:7660", key: "k2" };

describe("MechaLocator", () => {
  let locator: MechaLocator;

  beforeEach(() => {
    vi.clearAllMocks();
    locator = new MechaLocator({ cacheTtlMs: 5000 });
  });

  it("returns local ref when mecha found locally", async () => {
    mockMechaLs.mockResolvedValue([{ id: "mx-foo-abc", name: "n", state: "running", status: "Up", path: "/p", created: 0 }]);
    const ref = await locator.locate(client, "mx-foo-abc", [nodeA]);
    expect(ref).toEqual({ node: "local", id: "mx-foo-abc" });
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("returns remote ref when found on remote node", async () => {
    mockMechaLs.mockResolvedValue([]); // not local
    mockAgentFetch.mockResolvedValueOnce({
      json: async () => [{ id: "mx-foo-abc" }],
    });
    const ref = await locator.locate(client, "mx-foo-abc", [nodeA]);
    expect(ref).toEqual({ node: "gpu", id: "mx-foo-abc", entry: nodeA });
  });

  it("throws MechaNotLocatedError when not found anywhere", async () => {
    mockMechaLs.mockResolvedValue([]);
    mockAgentFetch.mockResolvedValueOnce({
      json: async () => [],
    });
    await expect(locator.locate(client, "mx-gone", [nodeA])).rejects.toThrow("Mecha not found on any node: mx-gone");
  });

  it("returns cached result within TTL", async () => {
    mockMechaLs.mockResolvedValue([{ id: "mx-foo-abc", name: "n", state: "running", status: "Up", path: "/p", created: 0 }]);
    await locator.locate(client, "mx-foo-abc", [nodeA]);
    mockMechaLs.mockClear();
    const ref = await locator.locate(client, "mx-foo-abc", [nodeA]);
    expect(ref).toEqual({ node: "local", id: "mx-foo-abc" });
    expect(mockMechaLs).not.toHaveBeenCalled();
  });

  it("re-queries after cache expires", async () => {
    const shortLocator = new MechaLocator({ cacheTtlMs: 1 });
    mockMechaLs.mockResolvedValue([{ id: "mx-foo-abc", name: "n", state: "running", status: "Up", path: "/p", created: 0 }]);
    await shortLocator.locate(client, "mx-foo-abc", [nodeA]);
    // Wait for cache to expire
    await new Promise((r) => setTimeout(r, 10));
    mockMechaLs.mockClear();
    mockMechaLs.mockResolvedValue([{ id: "mx-foo-abc", name: "n", state: "running", status: "Up", path: "/p", created: 0 }]);
    await shortLocator.locate(client, "mx-foo-abc", [nodeA]);
    expect(mockMechaLs).toHaveBeenCalled();
  });

  it("invalidate() forces re-lookup", async () => {
    mockMechaLs.mockResolvedValue([{ id: "mx-foo-abc", name: "n", state: "running", status: "Up", path: "/p", created: 0 }]);
    await locator.locate(client, "mx-foo-abc", [nodeA]);
    locator.invalidate("mx-foo-abc");
    mockMechaLs.mockClear();
    mockMechaLs.mockResolvedValue([{ id: "mx-foo-abc", name: "n", state: "running", status: "Up", path: "/p", created: 0 }]);
    await locator.locate(client, "mx-foo-abc", [nodeA]);
    expect(mockMechaLs).toHaveBeenCalled();
  });

  it("prefers local over remote when ID exists in both", async () => {
    mockMechaLs.mockResolvedValue([{ id: "mx-foo-abc", name: "n", state: "running", status: "Up", path: "/p", created: 0 }]);
    const ref = await locator.locate(client, "mx-foo-abc", [nodeA, nodeB]);
    expect(ref.node).toBe("local");
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("skips unreachable remote nodes and continues scanning", async () => {
    mockMechaLs.mockResolvedValue([]); // not local
    mockAgentFetch
      .mockRejectedValueOnce(new NodeUnreachableError("gpu")) // nodeA fails
      .mockResolvedValueOnce({ json: async () => [{ id: "mx-foo-abc" }] }); // nodeB succeeds
    const ref = await locator.locate(client, "mx-foo-abc", [nodeA, nodeB]);
    expect(ref).toEqual({ node: "work", id: "mx-foo-abc", entry: nodeB });
  });

  it("propagates non-unreachable errors from remote nodes", async () => {
    mockMechaLs.mockResolvedValue([]); // not local
    const authErr = new Error("Auth failed");
    mockAgentFetch.mockRejectedValueOnce(authErr);
    await expect(locator.locate(client, "mx-foo-abc", [nodeA])).rejects.toThrow("Auth failed");
  });

  it("uses default TTL of 30s when no options provided", async () => {
    const defaultLocator = new MechaLocator();
    mockMechaLs.mockResolvedValue([{ id: "mx-foo-abc", name: "n", state: "running", status: "Up", path: "/p", created: 0 }]);
    const ref = await defaultLocator.locate(client, "mx-foo-abc", []);
    expect(ref.node).toBe("local");
  });

  it("clear() empties all entries", async () => {
    mockMechaLs.mockResolvedValue([{ id: "mx-foo-abc", name: "n", state: "running", status: "Up", path: "/p", created: 0 }]);
    await locator.locate(client, "mx-foo-abc", [nodeA]);
    locator.clear();
    mockMechaLs.mockClear();
    mockMechaLs.mockResolvedValue([{ id: "mx-foo-abc", name: "n", state: "running", status: "Up", path: "/p", created: 0 }]);
    await locator.locate(client, "mx-foo-abc", [nodeA]);
    expect(mockMechaLs).toHaveBeenCalled();
  });
});
