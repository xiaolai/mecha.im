import { describe, it, expect, vi } from "vitest";
import { textResult, errorResult, withAuditAndRateLimit, annotationsFor } from "../../src/tools/helpers.js";
import type { MeshMcpContext, ToolName } from "../../src/types.js";
import { TOOL_ANNOTATIONS } from "../../src/types.js";

function makeCtx(overrides: Partial<MeshMcpContext> = {}): MeshMcpContext {
  return {
    mechaDir: "/tmp/mecha",
    pm: {} as never,
    getNodes: vi.fn().mockReturnValue([]),
    agentFetch: vi.fn() as never,
    mode: "query",
    audit: { append: vi.fn(), read: vi.fn().mockReturnValue([]), clear: vi.fn() },
    rateLimiter: { check: vi.fn().mockReturnValue(true), remaining: vi.fn().mockReturnValue(100) },
    ...overrides,
  };
}

describe("textResult", () => {
  it("returns text content", () => {
    const result = textResult("hello");
    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    expect(result.isError).toBeUndefined();
  });
});

describe("errorResult", () => {
  it("returns error content", () => {
    const result = errorResult("bad");
    expect(result.content).toEqual([{ type: "text", text: "bad" }]);
    expect(result.isError).toBe(true);
  });
});

describe("withAuditAndRateLimit", () => {
  it("returns rate limit error when blocked", async () => {
    const ctx = makeCtx({
      rateLimiter: { check: vi.fn().mockReturnValue(false), remaining: vi.fn().mockReturnValue(0) },
    });
    const fn = vi.fn();
    const wrapped = withAuditAndRateLimit(ctx, "mecha_list_casas", fn);
    const result = await wrapped({});
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("Rate limited");
    expect(fn).not.toHaveBeenCalled();
  });

  it("uses clientInfo when available", async () => {
    const ctx = makeCtx({
      clientInfo: { name: "claude-desktop", version: "1.2.3" },
    });
    const fn = vi.fn().mockResolvedValue(textResult("ok"));
    const wrapped = withAuditAndRateLimit(ctx, "mecha_list_casas", fn);
    await wrapped({});
    expect(ctx.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ client: "claude-desktop/1.2.3" }),
    );
  });

  it("uses 'unknown' when no clientInfo", async () => {
    const ctx = makeCtx();
    const fn = vi.fn().mockResolvedValue(textResult("ok"));
    const wrapped = withAuditAndRateLimit(ctx, "mecha_list_casas", fn);
    await wrapped({});
    expect(ctx.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ client: "unknown" }),
    );
  });

  it("audits successful calls", async () => {
    const ctx = makeCtx();
    const fn = vi.fn().mockResolvedValue(textResult("data"));
    const wrapped = withAuditAndRateLimit(ctx, "mecha_discover", fn);
    await wrapped({ tag: "research" });
    expect(ctx.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "mecha_discover",
        result: "ok",
        params: { tag: "research" },
      }),
    );
  });

  it("audits error results from tool", async () => {
    const ctx = makeCtx();
    const fn = vi.fn().mockResolvedValue(errorResult("not found"));
    const wrapped = withAuditAndRateLimit(ctx, "mecha_casa_status", fn);
    await wrapped({ target: "bob" });
    expect(ctx.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "error",
        error: "not found",
      }),
    );
  });

  it("catches thrown errors and returns error result", async () => {
    const ctx = makeCtx();
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    const wrapped = withAuditAndRateLimit(ctx, "mecha_list_casas", fn);
    const result = await wrapped({});
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toBe("boom");
    expect(ctx.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ result: "error", error: "boom" }),
    );
  });

  it("handles non-Error thrown values", async () => {
    const ctx = makeCtx();
    const fn = vi.fn().mockRejectedValue("string error");
    const wrapped = withAuditAndRateLimit(ctx, "mecha_list_casas", fn);
    const result = await wrapped({});
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toBe("string error");
  });
});

describe("annotationsFor", () => {
  it("returns annotations for each tool", () => {
    for (const name of Object.keys(TOOL_ANNOTATIONS) as ToolName[]) {
      const ann = annotationsFor(name);
      expect(ann).toHaveProperty("readOnlyHint");
      expect(ann).toHaveProperty("destructiveHint");
    }
  });

  it("marks query as non-readOnly", () => {
    expect(annotationsFor("mecha_query").readOnlyHint).toBe(false);
  });

  it("marks read tools as readOnly", () => {
    expect(annotationsFor("mecha_list_casas").readOnlyHint).toBe(true);
    expect(annotationsFor("mecha_discover").readOnlyHint).toBe(true);
  });
});
