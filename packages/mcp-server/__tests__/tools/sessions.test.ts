import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeCtx, callTool, getText } from "../test-helpers.js";

vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    botSessionList: vi.fn().mockResolvedValue([]),
    botSessionGet: vi.fn().mockResolvedValue(undefined),
  };
});

import { botSessionList, botSessionGet } from "@mecha/service";

beforeEach(() => {
  vi.clearAllMocks();
  (botSessionList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (botSessionGet as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe("mecha_list_sessions", () => {
  it("returns sessions for a bot", async () => {
    (botSessionList as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "sess-1", title: "First session", createdAt: "2026-02-27T10:00:00Z" },
      { id: "sess-2", title: "Second session", createdAt: "2026-02-27T11:00:00Z" },
    ]);
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_list_sessions", { target: "alice" });
    const text = getText(result);
    expect(text).toContain("sess-1");
    expect(text).toContain("sess-2");
    expect(result.isError).toBeUndefined();
  });

  it("returns message when no sessions found", async () => {
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_list_sessions", { target: "alice" });
    expect(getText(result)).toContain("No sessions found");
  });

  it("respects limit", async () => {
    (botSessionList as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "s1" }, { id: "s2" }, { id: "s3" },
    ]);
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_list_sessions", { target: "alice", limit: 2 });
    const text = getText(result);
    expect(text).toContain("s1");
    expect(text).toContain("s2");
    expect(text).not.toContain("s3");
  });

  it("handles errors", async () => {
    (botSessionList as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("bot not found"));
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_list_sessions", { target: "unknown" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("bot not found");
  });
});

describe("mecha_get_session", () => {
  it("returns session detail", async () => {
    const sessionData = {
      id: "sess-1",
      title: "Research session",
      messages: [{ role: "user", content: "hello" }],
    };
    (botSessionGet as ReturnType<typeof vi.fn>).mockResolvedValue(sessionData);
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_get_session", { target: "alice", sessionId: "sess-1" });
    const text = getText(result);
    expect(text).toContain("sess-1");
    expect(text).toContain("Research session");
    expect(result.isError).toBeUndefined();
  });

  it("returns error when session not found", async () => {
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_get_session", { target: "alice", sessionId: "nonexistent" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("not found");
  });

  it("handles service errors", async () => {
    (botSessionGet as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("connection refused"));
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_get_session", { target: "alice", sessionId: "sess-1" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("connection refused");
  });
});
