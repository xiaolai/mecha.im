import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleMeshTool, type MeshOpts, type MeshRouter } from "../../src/mcp/mesh-tools.js";
import { AclDeniedError, CasaNotFoundError } from "@mecha/core";

describe("mesh_discover", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mesh-test-"));
  });
  afterEach(() => { rmSync(mechaDir, { recursive: true, force: true }); });

  /** Write a discovery.json index with the given CASA entries */
  function writeDiscoveryIndex(
    casas: Array<{ name: string; tags?: string[]; expose?: string[]; state?: string }>,
  ): void {
    const index = {
      version: 1,
      updatedAt: new Date().toISOString(),
      casas: casas.map((c) => ({
        name: c.name,
        tags: c.tags ?? [],
        expose: c.expose ?? [],
        state: c.state ?? "running",
      })),
    };
    writeFileSync(join(mechaDir, "discovery.json"), JSON.stringify(index));
  }

  it("discovers other CASAs excluding self", async () => {
    writeDiscoveryIndex([
      { name: "alice", tags: ["research"] },
      { name: "bob", tags: ["code"] },
    ]);

    const opts: MeshOpts = { mechaDir, casaName: "alice" };
    const result = await handleMeshTool(opts, "mesh_discover", {});

    expect(result.content[0].text).toContain("bob");
    expect(result.content[0].text).not.toContain("alice");
    expect(result.isError).toBeUndefined();
  });

  it("filters by tag", async () => {
    writeDiscoveryIndex([
      { name: "alice", tags: ["research"] },
      { name: "bob", tags: ["code"] },
    ]);

    const opts: MeshOpts = { mechaDir, casaName: "caller" };
    const result = await handleMeshTool(opts, "mesh_discover", { tag: "research" });

    expect(result.content[0].text).toContain("alice");
    expect(result.content[0].text).not.toContain("bob");
  });

  it("filters by capability", async () => {
    writeDiscoveryIndex([
      { name: "alice", expose: ["query"] },
      { name: "bob", expose: ["execute"] },
    ]);

    const opts: MeshOpts = { mechaDir, casaName: "caller" };
    const result = await handleMeshTool(opts, "mesh_discover", { capability: "query" });

    expect(result.content[0].text).toContain("alice");
    expect(result.content[0].text).not.toContain("bob");
  });

  it("returns message when no matches", async () => {
    const opts: MeshOpts = { mechaDir, casaName: "caller" };
    const result = await handleMeshTool(opts, "mesh_discover", {});

    expect(result.content[0].text).toBe("No matching CASAs found");
  });

  it("rejects invalid capability", async () => {
    const opts: MeshOpts = { mechaDir, casaName: "caller" };
    const result = await handleMeshTool(opts, "mesh_discover", { capability: "bogus" });

    expect(result.content[0].text).toContain("Invalid capability");
    expect(result.isError).toBe(true);
  });

  it("skips non-CASA directories listed in index", async () => {
    writeDiscoveryIndex([
      { name: "alice" },
    ]);

    const opts: MeshOpts = { mechaDir, casaName: "caller" };
    const result = await handleMeshTool(opts, "mesh_discover", {});

    expect(result.content[0].text).toContain("alice");
  });

  it("filters out non-running CASAs", async () => {
    writeDiscoveryIndex([
      { name: "alive", tags: ["code"], state: "running" },
      { name: "dead", tags: ["code"], state: "stopped" },
      { name: "broken", tags: ["code"], state: "error" },
    ]);

    const opts: MeshOpts = { mechaDir, casaName: "caller" };
    const result = await handleMeshTool(opts, "mesh_discover", {});

    expect(result.content[0].text).toContain("alive");
    expect(result.content[0].text).not.toContain("dead");
    expect(result.content[0].text).not.toContain("broken");
  });

  it("returns empty when discovery.json is corrupt", async () => {
    writeFileSync(join(mechaDir, "discovery.json"), "not-json{");

    const opts: MeshOpts = { mechaDir, casaName: "caller" };
    const result = await handleMeshTool(opts, "mesh_discover", {});

    expect(result.content[0].text).toBe("No matching CASAs found");
  });
});

describe("mesh_query", () => {
  let mechaDir: string;
  let mockRouter: MeshRouter;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mesh-test-"));
    mockRouter = {
      routeQuery: vi.fn().mockResolvedValue({ text: "response", sessionId: undefined }),
    };
  });
  afterEach(() => { rmSync(mechaDir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  it("delegates to router on success", async () => {
    vi.mocked(mockRouter.routeQuery).mockResolvedValue({ text: "Found papers", sessionId: undefined });

    const opts: MeshOpts = { mechaDir, casaName: "coder", router: mockRouter };
    const result = await handleMeshTool(opts, "mesh_query", { target: "researcher", message: "find papers" });

    expect(result.content[0].text).toBe("Found papers");
    expect(result.isError).toBeUndefined();
    expect(mockRouter.routeQuery).toHaveBeenCalledWith("coder", "researcher", "find papers", undefined);
  });

  it("threads sessionId through and returns it as _meta", async () => {
    vi.mocked(mockRouter.routeQuery).mockResolvedValue({ text: "Continued", sessionId: "sess-123" });

    const opts: MeshOpts = { mechaDir, casaName: "coder", router: mockRouter };
    const result = await handleMeshTool(opts, "mesh_query", {
      target: "researcher", message: "continue", sessionId: "sess-123",
    });

    expect(result.content[0].text).toBe("Continued");
    expect(result._meta).toEqual({ sessionId: "sess-123" });
    expect(result.isError).toBeUndefined();
    expect(mockRouter.routeQuery).toHaveBeenCalledWith("coder", "researcher", "continue", "sess-123");
  });

  it("does not include _meta when sessionId not returned", async () => {
    vi.mocked(mockRouter.routeQuery).mockResolvedValue({ text: "One-shot answer", sessionId: undefined });

    const opts: MeshOpts = { mechaDir, casaName: "coder", router: mockRouter };
    const result = await handleMeshTool(opts, "mesh_query", { target: "researcher", message: "hello" });

    expect(result.content[0].text).toBe("One-shot answer");
    expect(result._meta).toBeUndefined();
  });

  it("returns Access denied on AclDeniedError", async () => {
    vi.mocked(mockRouter.routeQuery).mockRejectedValue(
      new AclDeniedError("coder", "query", "researcher"),
    );

    const opts: MeshOpts = { mechaDir, casaName: "coder", router: mockRouter };
    const result = await handleMeshTool(opts, "mesh_query", { target: "researcher", message: "hello" });

    expect(result.content[0].text).toContain("Access denied");
    expect(result.isError).toBe(true);
  });

  it("returns CASA not found on CasaNotFoundError", async () => {
    vi.mocked(mockRouter.routeQuery).mockRejectedValue(
      new CasaNotFoundError("ghost"),
    );

    const opts: MeshOpts = { mechaDir, casaName: "coder", router: mockRouter };
    const result = await handleMeshTool(opts, "mesh_query", { target: "ghost", message: "hello" });

    expect(result.content[0].text).toContain("CASA not found");
    expect(result.isError).toBe(true);
  });

  it("returns error on generic failure", async () => {
    vi.mocked(mockRouter.routeQuery).mockRejectedValue(new Error("HTTP 500"));

    const opts: MeshOpts = { mechaDir, casaName: "coder", router: mockRouter };
    const result = await handleMeshTool(opts, "mesh_query", { target: "researcher", message: "hello" });

    expect(result.content[0].text).toBe("Mesh query failed");
    expect(result.isError).toBe(true);
  });

  it("returns error when missing required fields", async () => {
    const opts: MeshOpts = { mechaDir, casaName: "coder", router: mockRouter };
    const result = await handleMeshTool(opts, "mesh_query", {});

    expect(result.content[0].text).toContain("Missing required");
    expect(result.isError).toBe(true);
  });

  it("returns error when target is empty string", async () => {
    const opts: MeshOpts = { mechaDir, casaName: "coder", router: mockRouter };
    const result = await handleMeshTool(opts, "mesh_query", { target: "", message: "hello" });

    expect(result.content[0].text).toContain("Missing required: target");
    expect(result.isError).toBe(true);
  });

  it("returns error when message is empty string", async () => {
    const opts: MeshOpts = { mechaDir, casaName: "coder", router: mockRouter };
    const result = await handleMeshTool(opts, "mesh_query", { target: "researcher", message: "" });

    expect(result.content[0].text).toContain("Missing required: message");
    expect(result.isError).toBe(true);
  });

  it("returns error when sessionId is not a string", async () => {
    const opts: MeshOpts = { mechaDir, casaName: "coder", router: mockRouter };
    const result = await handleMeshTool(opts, "mesh_query", {
      target: "researcher", message: "hello", sessionId: 123,
    });

    expect(result.content[0].text).toBe("sessionId must be a string");
    expect(result.isError).toBe(true);
  });

  it("returns error when router not available", async () => {
    const opts: MeshOpts = { mechaDir, casaName: "coder" };
    const result = await handleMeshTool(opts, "mesh_query", { target: "researcher", message: "hello" });

    expect(result.content[0].text).toBe("Mesh routing not available");
    expect(result.isError).toBe(true);
  });
});

describe("unknown mesh tool", () => {
  it("returns error for unknown tool name", async () => {
    const mechaDir = mkdtempSync(join(tmpdir(), "mesh-test-"));
    const opts: MeshOpts = { mechaDir, casaName: "test" };
    const result = await handleMeshTool(opts, "mesh_unknown", {});

    expect(result.content[0].text).toContain("Unknown mesh tool");
    expect(result.isError).toBe(true);

    rmSync(mechaDir, { recursive: true, force: true });
  });
});
