import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  convertSessionMessages,
  fetchSessionHistory,
} from "../src/lib/session-history";
import type { ParsedMessage, ContentBlock } from "@mecha/core";

function makeMsg(role: "user" | "assistant", text: string, ts = "2026-01-15T10:00:00.000Z"): ParsedMessage {
  return {
    uuid: "msg-1",
    parentUuid: null,
    role,
    content: [{ type: "text", text } as ContentBlock],
    timestamp: new Date(ts),
  };
}

describe("convertSessionMessages", () => {
  it("converts an empty array", () => {
    expect(convertSessionMessages([])).toEqual([]);
  });

  it("converts a single user message", () => {
    const result = convertSessionMessages([makeMsg("user", "hello")]);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("hello");
    expect(result[0].createdAt).toEqual(new Date("2026-01-15T10:00:00.000Z"));
  });

  it("converts a multi-turn conversation preserving order", () => {
    const input: ParsedMessage[] = [
      makeMsg("user", "What is 2+2?", "2026-01-15T10:00:00.000Z"),
      makeMsg("assistant", "4", "2026-01-15T10:00:01.000Z"),
      makeMsg("user", "And 3+3?", "2026-01-15T10:00:05.000Z"),
      makeMsg("assistant", "6", "2026-01-15T10:00:06.000Z"),
    ];
    const result = convertSessionMessages(input);

    expect(result).toHaveLength(4);
    expect(result.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(result.map((m) => m.content)).toEqual(["What is 2+2?", "4", "And 3+3?", "6"]);
  });

  it("extracts only text blocks from rich content", () => {
    const msg: ParsedMessage = {
      uuid: "msg-1",
      parentUuid: null,
      role: "assistant",
      content: [
        { type: "thinking", thinking: "let me think..." } as ContentBlock,
        { type: "text", text: "Here is the answer" } as ContentBlock,
        { type: "tool_use", id: "t1", name: "bash", input: {} } as ContentBlock,
        { type: "text", text: "And more" } as ContentBlock,
      ],
      timestamp: new Date("2026-01-15T10:00:00.000Z"),
    };
    const result = convertSessionMessages([msg]);

    expect(result[0].content).toBe("Here is the answer\nAnd more");
  });

  it("creates Date objects from timestamps", () => {
    const result = convertSessionMessages([makeMsg("user", "test", "2026-06-15T14:30:45.123Z")]);

    expect(result[0].createdAt).toBeInstanceOf(Date);
    expect(result[0].createdAt!.toISOString()).toBe("2026-06-15T14:30:45.123Z");
  });
});

describe("fetchSessionHistory", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches session detail and returns converted messages", async () => {
    const mockDetail = {
      id: "sess-1",
      projectSlug: "-home-mecha",
      title: "test",
      messageCount: 2,
      createdAt: "2026-01-15T10:00:00.000Z",
      updatedAt: "2026-01-15T10:00:01.000Z",
      messages: [
        {
          uuid: "m1", parentUuid: null, role: "user",
          content: [{ type: "text", text: "hi" }],
          timestamp: "2026-01-15T10:00:00.000Z",
        },
        {
          uuid: "m2", parentUuid: "m1", role: "assistant",
          content: [{ type: "text", text: "hello" }],
          timestamp: "2026-01-15T10:00:01.000Z",
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDetail),
    });

    const result = await fetchSessionHistory("mecha-1", "sess-1");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/mechas/mecha-1/sessions/sess-1",
    );
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("hi");
    expect(result[1].role).toBe("assistant");
    expect(result[1].content).toBe("hello");
  });

  it("returns empty array on HTTP error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await fetchSessionHistory("mecha-1", "missing-session");

    expect(result).toEqual([]);
  });

  it("returns empty array when messages field is missing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "s" }),
    });

    const result = await fetchSessionHistory("mecha-1", "sess-empty");

    expect(result).toEqual([]);
  });

  it("returns empty array when fetch rejects (network error)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await fetchSessionHistory("mecha-1", "sess-1");

    expect(result).toEqual([]);
  });

  it("appends ?node= param for remote nodes", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "s", messages: [] }),
    });

    await fetchSessionHistory("mecha-1", "sess-1", "gpu-node");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/mechas/mecha-1/sessions/sess-1?node=gpu-node",
    );
  });

  it("omits ?node= param for local nodes", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "s", messages: [] }),
    });

    await fetchSessionHistory("mecha-1", "sess-1", "local");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/mechas/mecha-1/sessions/sess-1",
    );
  });

  it("returns empty array when JSON parsing throws", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    });

    const result = await fetchSessionHistory("mecha-1", "sess-1");

    expect(result).toEqual([]);
  });
});
