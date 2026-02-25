import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleMeshTool, type MeshOpts } from "../../src/mcp/mesh-tools.js";

describe("mesh_discover", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mesh-test-"));
  });
  afterEach(() => { rmSync(mechaDir, { recursive: true, force: true }); });

  function writeCasa(name: string, cfg: Record<string, unknown>): void {
    const dir = join(mechaDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
  }

  it("discovers other CASAs excluding self", async () => {
    writeCasa("alice", { port: 7700, token: "t", workspace: "/a", tags: ["research"] });
    writeCasa("bob", { port: 7701, token: "t", workspace: "/b", tags: ["code"] });

    const opts: MeshOpts = { mechaDir, casaName: "alice" };
    const result = await handleMeshTool(opts, "mesh_discover", {});

    expect(result.content[0].text).toContain("bob");
    expect(result.content[0].text).not.toContain("alice");
    expect(result.isError).toBeUndefined();
  });

  it("filters by tag", async () => {
    writeCasa("alice", { port: 7700, token: "t", workspace: "/a", tags: ["research"] });
    writeCasa("bob", { port: 7701, token: "t", workspace: "/b", tags: ["code"] });

    const opts: MeshOpts = { mechaDir, casaName: "caller" };
    const result = await handleMeshTool(opts, "mesh_discover", { tag: "research" });

    expect(result.content[0].text).toContain("alice");
    expect(result.content[0].text).not.toContain("bob");
  });

  it("filters by capability", async () => {
    writeCasa("alice", { port: 7700, token: "t", workspace: "/a", expose: ["query"] });
    writeCasa("bob", { port: 7701, token: "t", workspace: "/b", expose: ["execute"] });

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

  it("skips non-CASA directories", async () => {
    mkdirSync(join(mechaDir, "identity"), { recursive: true });
    mkdirSync(join(mechaDir, "tools"), { recursive: true });
    mkdirSync(join(mechaDir, "auth"), { recursive: true });
    writeCasa("alice", { port: 7700, token: "t", workspace: "/a" });

    const opts: MeshOpts = { mechaDir, casaName: "caller" };
    const result = await handleMeshTool(opts, "mesh_discover", {});

    expect(result.content[0].text).toContain("alice");
    expect(result.content[0].text).not.toContain("identity");
    expect(result.content[0].text).not.toContain("tools");
  });
});

describe("mesh_query", () => {
  let mechaDir: string;

  beforeEach(() => {
    mechaDir = mkdtempSync(join(tmpdir(), "mesh-test-"));
  });
  afterEach(() => { rmSync(mechaDir, { recursive: true, force: true }); });

  function writeCasa(name: string, cfg: Record<string, unknown>): void {
    const dir = join(mechaDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
  }

  function writeAcl(rules: Array<{ source: string; target: string; capabilities: string[] }>): void {
    writeFileSync(join(mechaDir, "acl.json"), JSON.stringify({ version: 1, rules }));
  }

  it("returns error when ACL denies", async () => {
    writeCasa("researcher", { port: 7700, token: "t", workspace: "/ws", expose: ["query"] });
    // No ACL grant

    const opts: MeshOpts = { mechaDir, casaName: "coder" };
    const result = await handleMeshTool(opts, "mesh_query", { target: "researcher", message: "hello" });

    expect(result.content[0].text).toContain("Access denied");
    expect(result.isError).toBe(true);
  });

  it("returns not_exposed when target does not expose query", async () => {
    writeCasa("researcher", { port: 7700, token: "t", workspace: "/ws", expose: ["read_workspace"] });
    writeAcl([{ source: "coder", target: "researcher", capabilities: ["query"] }]);

    const opts: MeshOpts = { mechaDir, casaName: "coder" };
    const result = await handleMeshTool(opts, "mesh_query", { target: "researcher", message: "hello" });

    expect(result.content[0].text).toContain("does not expose");
    expect(result.isError).toBe(true);
  });

  it("returns error when target has no config", async () => {
    writeAcl([{ source: "coder", target: "ghost", capabilities: ["query"] }]);
    // ghost has no config.json — config-first read fails before ACL check

    const opts: MeshOpts = { mechaDir, casaName: "coder" };
    const result = await handleMeshTool(opts, "mesh_query", { target: "ghost", message: "hello" });

    expect(result.content[0].text).toContain("CASA not found");
    expect(result.isError).toBe(true);
  });

  it("returns error when target config removed", async () => {
    writeCasa("vanished", { port: 9999, token: "t", workspace: "/ws", expose: ["query"] });
    writeAcl([{ source: "coder", target: "vanished", capabilities: ["query"] }]);
    // Remove config after creating it
    const { rmSync: rm } = await import("node:fs");
    rm(join(mechaDir, "vanished", "config.json"));

    const opts: MeshOpts = { mechaDir, casaName: "coder" };
    const result = await handleMeshTool(opts, "mesh_query", { target: "vanished", message: "hello" });

    // Config-first read fails
    expect(result.content[0].text).toContain("CASA not found");
    expect(result.isError).toBe(true);
  });

  it("forwards to target on success", async () => {
    writeCasa("researcher", { port: 7700, token: "tok", workspace: "/ws", expose: ["query"] });
    writeAcl([{ source: "coder", target: "researcher", capabilities: ["query"] }]);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ response: "Found papers" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const opts: MeshOpts = { mechaDir, casaName: "coder" };
    const result = await handleMeshTool(opts, "mesh_query", { target: "researcher", message: "find papers" });

    expect(result.content[0].text).toBe("Found papers");
    expect(result.isError).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:7700/api/chat",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer tok" }),
      }),
    );

    fetchSpy.mockRestore();
  });

  it("returns error on HTTP failure", async () => {
    writeCasa("researcher", { port: 7700, token: "tok", workspace: "/ws", expose: ["query"] });
    writeAcl([{ source: "coder", target: "researcher", capabilities: ["query"] }]);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("error", { status: 500 }),
    );

    const opts: MeshOpts = { mechaDir, casaName: "coder" };
    const result = await handleMeshTool(opts, "mesh_query", { target: "researcher", message: "hello" });

    expect(result.content[0].text).toContain("HTTP 500");
    expect(result.isError).toBe(true);

    fetchSpy.mockRestore();
  });

  it("returns error when missing required fields", async () => {
    const opts: MeshOpts = { mechaDir, casaName: "coder" };
    const result = await handleMeshTool(opts, "mesh_query", {});

    expect(result.content[0].text).toContain("Missing required");
    expect(result.isError).toBe(true);
  });

  it("returns plain text when response is not JSON", async () => {
    writeCasa("researcher", { port: 7700, token: "tok", workspace: "/ws", expose: ["query"] });
    writeAcl([{ source: "coder", target: "researcher", capabilities: ["query"] }]);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("plain text answer", { status: 200, headers: { "content-type": "text/plain" } }),
    );

    const opts: MeshOpts = { mechaDir, casaName: "coder" };
    const result = await handleMeshTool(opts, "mesh_query", { target: "researcher", message: "hello" });

    expect(result.content[0].text).toBe("plain text answer");
    expect(result.isError).toBeUndefined();

    fetchSpy.mockRestore();
  });

  it("returns JSON stringified when response.response is not a string", async () => {
    writeCasa("researcher", { port: 7700, token: "tok", workspace: "/ws", expose: ["query"] });
    writeAcl([{ source: "coder", target: "researcher", capabilities: ["query"] }]);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [1, 2, 3] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const opts: MeshOpts = { mechaDir, casaName: "coder" };
    const result = await handleMeshTool(opts, "mesh_query", { target: "researcher", message: "hello" });

    expect(result.content[0].text).toContain('"data"');
    expect(result.isError).toBeUndefined();

    fetchSpy.mockRestore();
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
