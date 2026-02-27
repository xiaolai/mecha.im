import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeCtx, callTool, getText } from "../test-helpers.js";

vi.mock("@mecha/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mecha/service")>();
  return {
    ...actual,
    casaSessionList: vi.fn().mockResolvedValue([]),
    casaSessionGet: vi.fn().mockResolvedValue(undefined),
  };
});

import { casaSessionList, casaSessionGet } from "@mecha/service";

beforeEach(() => {
  vi.clearAllMocks();
  (casaSessionList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (casaSessionGet as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe("mecha_list_sessions", () => {
  it("returns sessions for a CASA", async () => {
    (casaSessionList as ReturnType<typeof vi.fn>).mockResolvedValue([
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
    (casaSessionList as ReturnType<typeof vi.fn>).mockResolvedValue([
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
    (casaSessionList as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("CASA not found"));
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_list_sessions", { target: "unknown" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("CASA not found");
  });
});

describe("mecha_get_session", () => {
  it("returns session detail", async () => {
    const sessionData = {
      id: "sess-1",
      title: "Research session",
      messages: [{ role: "user", content: "hello" }],
    };
    (casaSessionGet as ReturnType<typeof vi.fn>).mockResolvedValue(sessionData);
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
    (casaSessionGet as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("connection refused"));
    const ctx = makeCtx();
    const result = await callTool(ctx, "mecha_get_session", { target: "alice", sessionId: "sess-1" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("connection refused");
  });
});
