import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveTarget } from "../../src/commands/resolve-target.js";
import type { NodeEntry } from "@mecha/agent";

const mockReadNodes = vi.fn();
vi.mock("@mecha/agent", () => ({
  readNodes: (...args: unknown[]) => mockReadNodes(...args),
}));

const mockLocate = vi.fn();
vi.mock("@mecha/service", () => ({
  MechaLocator: class {
    locate = (...args: unknown[]) => mockLocate(...args);
  },
}));

const client = {} as any;
const gpuNode: NodeEntry = { name: "gpu", host: "http://100.64.0.2:7660", key: "k1" };
const workNode: NodeEntry = { name: "work", host: "http://100.64.0.3:7660", key: "k2" };

describe("resolveTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("--node gpu returns remote target with matching entry", async () => {
    mockReadNodes.mockReturnValue([gpuNode, workNode]);
    const result = await resolveTarget(client, "mx-foo-abc", "gpu");
    expect(result).toEqual({ node: "gpu", entry: gpuNode });
    expect(mockLocate).not.toHaveBeenCalled();
  });

  it("--node nonexistent throws error", async () => {
    mockReadNodes.mockReturnValue([gpuNode]);
    await expect(resolveTarget(client, "mx-foo-abc", "nonexistent")).rejects.toThrow(
      'Node "nonexistent" not found in node registry',
    );
  });

  it("no --node, local mecha exists returns local target", async () => {
    mockReadNodes.mockReturnValue([gpuNode]);
    mockLocate.mockResolvedValue({ node: "local", id: "mx-foo-abc" });
    const result = await resolveTarget(client, "mx-foo-abc", undefined);
    expect(result).toEqual({ node: "local", entry: undefined });
  });

  it("no --node, only remote returns remote target with entry", async () => {
    mockReadNodes.mockReturnValue([gpuNode]);
    mockLocate.mockResolvedValue({ node: "gpu", id: "mx-foo-abc", entry: gpuNode });
    const result = await resolveTarget(client, "mx-foo-abc", undefined);
    expect(result).toEqual({ node: "gpu", entry: gpuNode });
  });

  it("no --node, not found throws MechaNotLocatedError", async () => {
    mockReadNodes.mockReturnValue([gpuNode]);
    mockLocate.mockRejectedValue(new Error("Mecha not found on any node: mx-gone"));
    await expect(resolveTarget(client, "mx-gone", undefined)).rejects.toThrow(
      "Mecha not found on any node: mx-gone",
    );
  });

  it("--node local returns local target without locator", async () => {
    const result = await resolveTarget(client, "mx-foo-abc", "local");
    expect(result).toEqual({ node: "local" });
    expect(mockLocate).not.toHaveBeenCalled();
    expect(mockReadNodes).not.toHaveBeenCalled();
  });
});
