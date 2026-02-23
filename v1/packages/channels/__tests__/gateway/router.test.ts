import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleInbound, consumeSSEResponse, extractText } from "../../src/gateway/router.js";
import type { GatewayDeps } from "../../src/gateway/router.js";
import type { ChannelAdapter, InboundMessage } from "../../src/adapters/types.js";

const mockSessionCreate = vi.fn();
const mockSessionMessage = vi.fn();

vi.mock("@mecha/service", () => ({
  mechaSessionCreate: (...args: unknown[]) => mockSessionCreate(...args),
  mechaSessionMessage: (...args: unknown[]) => mockSessionMessage(...args),
}));

function createMockAdapter(): ChannelAdapter & { sendText: ReturnType<typeof vi.fn>; sendTyping: ReturnType<typeof vi.fn> } {
  return {
    channelId: "ch-test",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendText: vi.fn().mockResolvedValue(undefined),
    sendTyping: vi.fn().mockResolvedValue(undefined),
  };
}

function createSSEResponse(events: Array<{ text?: string; content?: string; delta?: { text: string } }>): Response {
  const lines = events.map((e) => `data: ${JSON.stringify(e)}`).join("\n") + "\n";
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(lines));
      controller.close();
    },
  });
  return new Response(stream);
}

describe("extractText", () => {
  it("extracts result from mecha runtime result event", () => {
    expect(extractText({ type: "result", subtype: "success", result: "Hello!" })).toBe("Hello!");
  });

  it("returns null for mecha runtime session/system/assistant events", () => {
    expect(extractText({ type: "session", session_id: "s1" })).toBeNull();
    expect(extractText({ type: "system", subtype: "init" })).toBeNull();
    expect(extractText({ type: "assistant", message: { content: [{ type: "text", text: "Hi" }] } })).toBeNull();
  });

  it("extracts text from generic text field", () => {
    expect(extractText({ text: "hello" })).toBe("hello");
  });

  it("extracts text from generic content field", () => {
    expect(extractText({ content: "world" })).toBe("world");
  });

  it("extracts text from delta.text field", () => {
    expect(extractText({ delta: { text: "chunk" } })).toBe("chunk");
  });

  it("returns null when delta object has no text field", () => {
    expect(extractText({ delta: { content: "no text" } })).toBeNull();
  });

  it("returns null for unrecognized shapes", () => {
    expect(extractText({ foo: "bar" })).toBeNull();
  });

  it("ignores result event without string result", () => {
    expect(extractText({ type: "result", result: 123 } as any)).toBeNull();
  });
});

describe("consumeSSEResponse", () => {
  it("accumulates text from SSE data lines", async () => {
    const res = createSSEResponse([{ text: "Hello " }, { text: "world" }]);
    const result = await consumeSSEResponse(res);
    expect(result).toBe("Hello world");
  });

  it("supports content field", async () => {
    const res = createSSEResponse([{ content: "Hi" }]);
    const result = await consumeSSEResponse(res);
    expect(result).toBe("Hi");
  });

  it("supports delta.text field", async () => {
    const res = createSSEResponse([{ delta: { text: "Delta" } }]);
    const result = await consumeSSEResponse(res);
    expect(result).toBe("Delta");
  });

  it("returns empty string for no body", async () => {
    const res = new Response(null);
    const result = await consumeSSEResponse(res);
    expect(result).toBe("");
  });

  it("skips [DONE] marker", async () => {
    const lines = "data: {\"text\":\"hi\"}\ndata: [DONE]\n";
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(lines));
        controller.close();
      },
    });
    const result = await consumeSSEResponse(new Response(stream));
    expect(result).toBe("hi");
  });

  it("skips malformed JSON lines", async () => {
    const lines = "data: not-json\ndata: {\"text\":\"ok\"}\n";
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(lines));
        controller.close();
      },
    });
    const result = await consumeSSEResponse(new Response(stream));
    expect(result).toBe("ok");
  });

  it("skips non-data lines", async () => {
    const lines = "event: message\ndata: {\"text\":\"ok\"}\n\n";
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(lines));
        controller.close();
      },
    });
    const result = await consumeSSEResponse(new Response(stream));
    expect(result).toBe("ok");
  });

  it("handles data with no recognized text fields", async () => {
    const res = createSSEResponse([{ other: "field" } as any]);
    const result = await consumeSSEResponse(res);
    expect(result).toBe("");
  });

  it("processes trailing data in buffer after stream ends", async () => {
    // Stream that doesn't end with newline — data remains in buffer
    const rawData = "data: {\"text\":\"trailing\"}";
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(rawData));
        controller.close();
      },
    });
    const result = await consumeSSEResponse(new Response(stream));
    expect(result).toBe("trailing");
  });

  it("extracts result text from mecha runtime SSE stream", async () => {
    const events = [
      { type: "session", session_id: "s1" },
      { type: "system", subtype: "init", tools: [] },
      { type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } },
      { type: "result", subtype: "success", result: "Hello from mecha!" },
    ];
    const lines = events.map((e) => `data: ${JSON.stringify(e)}`).join("\n") + "\n";
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(lines));
        controller.close();
      },
    });
    const result = await consumeSSEResponse(new Response(stream));
    expect(result).toBe("Hello from mecha!");
  });

  it("skips empty data lines", async () => {
    const lines = "data: \ndata: {\"text\":\"ok\"}\n";
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(lines));
        controller.close();
      },
    });
    const result = await consumeSSEResponse(new Response(stream));
    expect(result).toBe("ok");
  });
});

describe("handleInbound", () => {
  let adapter: ReturnType<typeof createMockAdapter>;
  let deps: GatewayDeps;
  let mockStore: {
    getLink: ReturnType<typeof vi.fn>;
    updateSessionId: ReturnType<typeof vi.fn>;
  };

  const msg: InboundMessage = {
    chatId: "12345",
    text: "Hello",
    messageId: "1",
    from: { id: "67890", username: "user" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = createMockAdapter();
    mockStore = {
      getLink: vi.fn(),
      updateSessionId: vi.fn(),
    };
    deps = {
      store: mockStore as any,
      adapters: new Map([["ch-test", adapter]]),
      pm: {} as any,
    };
  });

  it("sends chat ID instructions when no link found", async () => {
    mockStore.getLink.mockReturnValue(undefined);
    await handleInbound(deps, "ch-test", msg);

    expect(adapter.sendText).toHaveBeenCalledWith(
      "12345",
      expect.stringContaining("Your chat ID is: 12345"),
    );
    expect(adapter.sendText).toHaveBeenCalledWith(
      "12345",
      expect.stringContaining("mecha channel link"),
    );
  });

  it("creates session and sends response when linked", async () => {
    mockStore.getLink.mockReturnValue({
      channel_id: "ch-test",
      chat_id: "12345",
      mecha_id: "mx-abc",
      session_id: null,
    });
    mockSessionCreate.mockResolvedValue({ sessionId: "sess-new" });
    mockSessionMessage.mockResolvedValue(
      createSSEResponse([{ text: "Bot reply" }]),
    );

    await handleInbound(deps, "ch-test", msg);

    expect(mockSessionCreate).toHaveBeenCalledWith(
      deps.pm,
      { id: "mx-abc", title: "telegram-12345" },
    );
    expect(mockStore.updateSessionId).toHaveBeenCalledWith("ch-test", "12345", "sess-new");
    expect(mockSessionMessage).toHaveBeenCalledWith(
      deps.pm,
      { id: "mx-abc", sessionId: "sess-new", message: "Hello" },
    );
    expect(adapter.sendText).toHaveBeenCalledWith("12345", "Bot reply");
  });

  it("reuses existing session_id when already set", async () => {
    mockStore.getLink.mockReturnValue({
      channel_id: "ch-test",
      chat_id: "12345",
      mecha_id: "mx-abc",
      session_id: "sess-existing",
    });
    mockSessionMessage.mockResolvedValue(
      createSSEResponse([{ text: "reply" }]),
    );

    await handleInbound(deps, "ch-test", msg);

    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockSessionMessage).toHaveBeenCalledWith(
      deps.pm,
      { id: "mx-abc", sessionId: "sess-existing", message: "Hello" },
    );
  });

  it("sends sanitized error message on failure", async () => {
    mockStore.getLink.mockReturnValue({
      channel_id: "ch-test",
      chat_id: "12345",
      mecha_id: "mx-abc",
      session_id: "sess-x",
    });
    mockSessionMessage.mockRejectedValue(new Error("connection refused"));

    await handleInbound(deps, "ch-test", msg);

    expect(adapter.sendText).toHaveBeenCalledWith(
      "12345",
      "Sorry, something went wrong. Please try again later.",
    );
  });

  it("sends typing indicator before processing", async () => {
    mockStore.getLink.mockReturnValue({
      channel_id: "ch-test",
      chat_id: "12345",
      mecha_id: "mx-abc",
      session_id: "sess-x",
    });
    mockSessionMessage.mockResolvedValue(
      createSSEResponse([{ type: "result", result: "hi" }]),
    );

    await handleInbound(deps, "ch-test", msg);

    expect(adapter.sendTyping).toHaveBeenCalledWith("12345");
  });

  it("does nothing when adapter not found", async () => {
    deps.adapters.clear();
    await handleInbound(deps, "ch-unknown", msg);
    expect(mockStore.getLink).not.toHaveBeenCalled();
  });

  it("does not send when response text is empty", async () => {
    mockStore.getLink.mockReturnValue({
      channel_id: "ch-test",
      chat_id: "12345",
      mecha_id: "mx-abc",
      session_id: "sess-x",
    });
    mockSessionMessage.mockResolvedValue(
      createSSEResponse([]),
    );

    await handleInbound(deps, "ch-test", msg);

    expect(adapter.sendText).not.toHaveBeenCalled();
  });

  it("sends sanitized message for non-Error throws", async () => {
    mockStore.getLink.mockReturnValue({
      channel_id: "ch-test",
      chat_id: "12345",
      mecha_id: "mx-abc",
      session_id: "sess-x",
    });
    mockSessionMessage.mockRejectedValue("string error");

    await handleInbound(deps, "ch-test", msg);

    expect(adapter.sendText).toHaveBeenCalledWith(
      "12345",
      "Sorry, something went wrong. Please try again later.",
    );
  });

  it("re-reads link to prevent duplicate session creation", async () => {
    // First call: no session_id
    mockStore.getLink
      .mockReturnValueOnce({
        channel_id: "ch-test",
        chat_id: "12345",
        mecha_id: "mx-abc",
        session_id: null,
      })
      // Second call inside processMessage: session already created
      .mockReturnValueOnce({
        channel_id: "ch-test",
        chat_id: "12345",
        mecha_id: "mx-abc",
        session_id: "sess-existing",
      });
    mockSessionMessage.mockResolvedValue(
      createSSEResponse([{ text: "reply" }]),
    );

    await handleInbound(deps, "ch-test", msg);

    // Should NOT have created a new session since re-read found one
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockSessionMessage).toHaveBeenCalledWith(
      deps.pm,
      { id: "mx-abc", sessionId: "sess-existing", message: "Hello" },
    );
  });
});
