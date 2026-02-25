import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { registerMcpRoutes } from "../../src/mcp/server.js";

describe("MCP routes", () => {
  let app: FastifyInstance;
  let workDir: string;

  beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), "mecha-mcp-test-"));
    writeFileSync(join(workDir, "hello.txt"), "Hello world");
    writeFileSync(join(workDir, "data.json"), '{"key":"value"}');
    mkdirSync(join(workDir, "subdir"));
    writeFileSync(join(workDir, "subdir", "nested.txt"), "nested content");

    app = Fastify();
    registerMcpRoutes(app, { workspacePath: workDir });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  function rpc(method: string, params?: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 1, method, params },
    });
  }

  describe("initialize", () => {
    it("returns server info", async () => {
      const res = await rpc("initialize");
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.jsonrpc).toBe("2.0");
      expect(body.result.serverInfo.name).toBe("mecha-casa");
      expect(body.result.capabilities.tools).toBeDefined();
    });
  });

  describe("tools/list", () => {
    it("returns workspace tools", async () => {
      const res = await rpc("tools/list");
      expect(res.statusCode).toBe(200);
      const { tools } = res.json().result;
      expect(tools).toHaveLength(2);
      expect(tools.map((t: { name: string }) => t.name)).toEqual([
        "mecha_workspace_list",
        "mecha_workspace_read",
      ]);
    });
  });

  describe("tools/call — mecha_workspace_list", () => {
    it("lists files in workspace root", async () => {
      const res = await rpc("tools/call", {
        name: "mecha_workspace_list",
        arguments: {},
      });
      expect(res.statusCode).toBe(200);
      const { content } = res.json().result;
      expect(content[0].text).toContain("hello.txt");
      expect(content[0].text).toContain("data.json");
      expect(content[0].text).toContain("subdir/");
    });

    it("lists files in subdirectory", async () => {
      const res = await rpc("tools/call", {
        name: "mecha_workspace_list",
        arguments: { path: "subdir" },
      });
      expect(res.statusCode).toBe(200);
      const { content } = res.json().result;
      expect(content[0].text).toContain("subdir/nested.txt");
    });

    it("returns error for nonexistent directory", async () => {
      const res = await rpc("tools/call", {
        name: "mecha_workspace_list",
        arguments: { path: "nope" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json().result;
      expect(body.isError).toBe(true);
      expect(body.content[0].text).toContain("Directory not found");
    });

    it("blocks path traversal", async () => {
      const res = await rpc("tools/call", {
        name: "mecha_workspace_list",
        arguments: { path: "../../etc" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json().result;
      expect(body.isError).toBe(true);
      expect(body.content[0].text).toContain("Path traversal not allowed");
    });

    it("lists root when path is omitted", async () => {
      const res = await rpc("tools/call", {
        name: "mecha_workspace_list",
        arguments: {},
      });
      expect(res.statusCode).toBe(200);
      const { content } = res.json().result;
      expect(content[0].text).toContain("hello.txt");
    });
  });

  describe("tools/call — mecha_workspace_read", () => {
    it("reads a file", async () => {
      const res = await rpc("tools/call", {
        name: "mecha_workspace_read",
        arguments: { path: "hello.txt" },
      });
      expect(res.statusCode).toBe(200);
      const { content } = res.json().result;
      expect(content[0].text).toBe("Hello world");
    });

    it("reads nested file", async () => {
      const res = await rpc("tools/call", {
        name: "mecha_workspace_read",
        arguments: { path: "subdir/nested.txt" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().result.content[0].text).toBe("nested content");
    });

    it("returns error for nonexistent file", async () => {
      const res = await rpc("tools/call", {
        name: "mecha_workspace_read",
        arguments: { path: "missing.txt" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json().result;
      expect(body.isError).toBe(true);
      expect(body.content[0].text).toContain("File not found");
    });

    it("returns error for directory path", async () => {
      const res = await rpc("tools/call", {
        name: "mecha_workspace_read",
        arguments: { path: "subdir" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json().result;
      expect(body.isError).toBe(true);
      expect(body.content[0].text).toContain("Path is a directory");
    });

    it("blocks path traversal", async () => {
      const res = await rpc("tools/call", {
        name: "mecha_workspace_read",
        arguments: { path: "../../etc/passwd" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json().result;
      expect(body.isError).toBe(true);
      expect(body.content[0].text).toContain("Path traversal not allowed");
    });
  });

  describe("tools/call — mecha_workspace_read file size limit", () => {
    it("returns error for file exceeding 10 MB", async () => {
      // Create a file just over 10 MB
      const bigPath = join(workDir, "big.bin");
      const { writeFileSync: writeFn } = require("node:fs") as typeof import("node:fs");
      writeFn(bigPath, Buffer.alloc(10 * 1024 * 1024 + 1));

      const res = await rpc("tools/call", {
        name: "mecha_workspace_read",
        arguments: { path: "big.bin" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json().result;
      expect(body.isError).toBe(true);
      expect(body.content[0].text).toContain("File too large");
    });
  });

  describe("unknown tool", () => {
    it("returns error", async () => {
      const res = await rpc("tools/call", {
        name: "nonexistent_tool",
        arguments: {},
      });
      expect(res.statusCode).toBe(200);
      const body = res.json().result;
      expect(body.isError).toBe(true);
      expect(body.content[0].text).toContain("Unknown tool");
    });
  });

  describe("unknown method", () => {
    it("returns method not found error", async () => {
      const res = await rpc("something/weird");
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.error.code).toBe(-32601);
      expect(body.error.message).toContain("Method not found");
    });
  });

  describe("invalid request", () => {
    it("returns 400 for missing jsonrpc field", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/mcp",
        payload: { method: "initialize" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe(-32600);
    });

    it("returns 400 for missing method", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/mcp",
        payload: { jsonrpc: "2.0", id: 1 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("tools/call with no arguments", () => {
    it("defaults to empty arguments", async () => {
      const res = await rpc("tools/call", {
        name: "mecha_workspace_list",
      });
      expect(res.statusCode).toBe(200);
      const { content } = res.json().result;
      expect(content[0].text).toContain("hello.txt");
    });
  });

  describe("tools/call without params", () => {
    it("defaults to empty params", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/mcp",
        payload: { jsonrpc: "2.0", id: 1, method: "tools/call" },
      });
      expect(res.statusCode).toBe(200);
      // No name provided → unknown tool error
      const body = res.json().result;
      expect(body.isError).toBe(true);
      expect(body.content[0].text).toContain("Unknown tool");
    });
  });

  describe("workspace_list on deleted workspace", () => {
    it("returns error with / for empty path", async () => {
      // Delete workspace dir to trigger catch on empty subpath
      rmSync(workDir, { recursive: true, force: true });
      const res = await rpc("tools/call", {
        name: "mecha_workspace_list",
        arguments: {},
      });
      expect(res.statusCode).toBe(200);
      const body = res.json().result;
      expect(body.isError).toBe(true);
      expect(body.content[0].text).toContain("Directory not found: /");
    });
  });

  describe("request without id", () => {
    it("returns null id", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/mcp",
        payload: { jsonrpc: "2.0", method: "initialize" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBeNull();
    });
  });
});

describe("MCP routes with mesh enabled", () => {
  let app: FastifyInstance;
  let workDir: string;
  let mechaDir: string;

  beforeEach(async () => {
    workDir = mkdtempSync(join(tmpdir(), "mecha-mcp-mesh-"));
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-mesh-"));
    writeFileSync(join(workDir, "file.txt"), "content");

    app = Fastify();
    registerMcpRoutes(app, { workspacePath: workDir, mechaDir, casaName: "alice" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(workDir, { recursive: true, force: true });
    rmSync(mechaDir, { recursive: true, force: true });
  });

  function rpc(method: string, params?: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 1, method, params },
    });
  }

  it("includes mesh tools in tools/list", async () => {
    const res = await rpc("tools/list");
    expect(res.statusCode).toBe(200);
    const { tools } = res.json().result;
    expect(tools).toHaveLength(4);
    const names = tools.map((t: { name: string }) => t.name);
    expect(names).toContain("mesh_query");
    expect(names).toContain("mesh_discover");
  });

  it("routes mesh_discover through handleMeshTool", async () => {
    const res = await rpc("tools/call", {
      name: "mesh_discover",
      arguments: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().result;
    expect(body.content[0].text).toBe("No matching CASAs found");
  });

  it("routes mesh_query with missing args", async () => {
    const res = await rpc("tools/call", {
      name: "mesh_query",
      arguments: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().result;
    expect(body.content[0].text).toContain("Missing required");
    expect(body.isError).toBe(true);
  });
});
