import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeCtx, callTool, getText } from "../test-helpers.js";

vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    runtimeFetch: vi.fn(),
  };
});

import { runtimeFetch } from "@mecha/service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mecha_workspace_list", () => {
  it("delegates to runtime MCP endpoint", async () => {
    (runtimeFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "src/\npackage.json\nREADME.md" }] },
      },
    });

    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_workspace_list", { target: "alice" });
    expect(getText(result)).toContain("src/");
    expect(getText(result)).toContain("package.json");

    expect(runtimeFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "/mcp",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          method: "tools/call",
          params: { name: "mecha_workspace_list", arguments: { path: "" } },
        }),
      }),
    );
  });

  it("passes subdirectory path", async () => {
    (runtimeFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "index.ts\nutils.ts" }] },
      },
    });

    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_workspace_list", { target: "alice", path: "src" });
    expect(getText(result)).toContain("index.ts");

    expect(runtimeFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "/mcp",
      expect.objectContaining({
        body: expect.objectContaining({
          params: { name: "mecha_workspace_list", arguments: { path: "src" } },
        }),
      }),
    );
  });

  it("handles JSON-RPC errors", async () => {
    (runtimeFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32600, message: "Invalid request" },
      },
    });

    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_workspace_list", { target: "alice" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("Invalid request");
  });

  it("handles fetch failures", async () => {
    (runtimeFetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("bot not running"));

    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_workspace_list", { target: "alice" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("bot not running");
  });
});

describe("mecha_workspace_read", () => {
  it("delegates to runtime MCP endpoint", async () => {
    (runtimeFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "console.log('hello');" }] },
      },
    });

    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_workspace_read", { target: "alice", path: "src/index.ts" });
    expect(getText(result)).toContain("console.log");

    expect(runtimeFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "/mcp",
      expect.objectContaining({
        body: expect.objectContaining({
          params: { name: "mecha_workspace_read", arguments: { path: "src/index.ts" } },
        }),
      }),
    );
  });

  it("handles JSON-RPC errors", async () => {
    (runtimeFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32600, message: "File not found" },
      },
    });

    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_workspace_read", { target: "alice", path: "missing.ts" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("File not found");
  });

  it("handles fetch failures", async () => {
    (runtimeFetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("bot not running"));

    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_workspace_read", { target: "alice", path: "file.ts" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("bot not running");
  });

  it("handles missing result gracefully", async () => {
    (runtimeFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      body: { jsonrpc: "2.0", id: 1 },
    });

    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_workspace_read", { target: "alice", path: "missing.txt" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("No result");
  });
});
