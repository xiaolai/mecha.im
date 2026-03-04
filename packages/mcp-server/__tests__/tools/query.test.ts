import { describe, it, expect, vi } from "vitest";
import { makeCtx, callTool, getText } from "../test-helpers.js";
import { createMeshMcpServer } from "../../src/server.js";

type ToolRegistry = Record<string, { handler: unknown }>;

describe("mecha_query", () => {
  it("returns not-yet-available message", async () => {
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_query", {
      target: "alice",
      message: "hello",
    });
    const text = getText(result);
    expect(text).toContain("not yet available");
    expect(text).toContain("wave 2");
    expect(text).toContain("mecha bot chat");
  });

  it("is only registered in query mode", () => {
    const readOnlyCtx = makeCtx({ mode: "read-only" });
    const server = createMeshMcpServer(readOnlyCtx);
    const tools = (server as unknown as { _registeredTools: ToolRegistry })._registeredTools;
    expect(Object.keys(tools)).not.toContain("mecha_query");
  });

  it("audits the call", async () => {
    const ctx = makeCtx();
    await callTool(ctx, "mecha_query", { target: "alice", message: "hello" });
    expect(ctx.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "mecha_query",
        result: "ok",
      }),
    );
  });
});
