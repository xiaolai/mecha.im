import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeCtx, callTool, getText } from "../test-helpers.js";

vi.mock("@mecha/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/core")>();
  return {
    ...actual,
    readCasaConfig: vi.fn().mockReturnValue({ tags: [], expose: [] }),
  };
});

describe("mecha_list_casas remote edge cases", () => {
  it("handles non-ok remote response", async () => {
    const ctx = makeCtx({
      getNodes: vi.fn().mockReturnValue([
        { name: "peer1", host: "192.168.1.10", port: 7660, apiKey: "k1", addedAt: "2026-01-01" },
      ]),
      agentFetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      }) as never,
    });

    const result = await callTool(ctx, "mecha_list_casas", { node: "peer1" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("500");
  });
});

describe("mecha_casa_status remote edge cases", () => {
  it("handles non-ok remote status response", async () => {
    const ctx = makeCtx({
      getNodes: vi.fn().mockReturnValue([
        { name: "peer1", host: "192.168.1.10", port: 7660, apiKey: "k1", addedAt: "2026-01-01" },
      ]),
      agentFetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      }) as never,
    });

    const result = await callTool(ctx, "mecha_casa_status", { target: "alice@peer1" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("404");
  });

  it("handles remote fetch failure for status", async () => {
    const ctx = makeCtx({
      getNodes: vi.fn().mockReturnValue([
        { name: "peer1", host: "192.168.1.10", port: 7660, apiKey: "k1", addedAt: "2026-01-01" },
      ]),
      agentFetch: vi.fn().mockRejectedValue(new Error("timeout")) as never,
    });

    const result = await callTool(ctx, "mecha_casa_status", { target: "alice@peer1" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("timeout");
  });
});

describe("mecha_discover with no expose config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles missing expose in config", async () => {
    const { readCasaConfig } = await import("@mecha/core");
    (readCasaConfig as ReturnType<typeof vi.fn>).mockReturnValue({ tags: ["test"] });
    const pm = {
      get: vi.fn(),
      list: vi.fn().mockReturnValue([
        { name: "alice", state: "running", port: 7700, workspacePath: "/a" },
      ]),
      getPortAndToken: vi.fn(),
    };
    const ctx = makeCtx({ pm: pm as never });

    const result = await callTool(ctx, "mecha_discover", { capability: "query" });
    expect(getText(result)).toContain("No CASAs match");
  });
});
