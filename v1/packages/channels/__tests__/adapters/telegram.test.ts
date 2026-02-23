import { describe, it, expect, vi, beforeEach } from "vitest";
import { chunkText, TelegramAdapter } from "../../src/adapters/telegram.js";

describe("chunkText", () => {
  it("returns single chunk for short text", () => {
    expect(chunkText("hello", 10)).toEqual(["hello"]);
  });

  it("returns single chunk for text equal to max length", () => {
    const text = "a".repeat(4000);
    expect(chunkText(text)).toEqual([text]);
  });

  it("splits at newline boundary when possible", () => {
    const text = "line1\nline2\nline3";
    const chunks = chunkText(text, 10);
    expect(chunks[0]).toBe("line1");
    expect(chunks[1]).toBe("line2");
    expect(chunks[2]).toBe("line3");
  });

  it("splits at maxLen when no newline found", () => {
    const text = "a".repeat(20);
    const chunks = chunkText(text, 8);
    expect(chunks[0]).toBe("a".repeat(8));
    expect(chunks[1]).toBe("a".repeat(8));
    expect(chunks[2]).toBe("a".repeat(4));
  });

  it("handles empty string", () => {
    expect(chunkText("", 10)).toEqual([""]);
  });

  it("returns entire text when maxLen is zero or negative", () => {
    expect(chunkText("hello world", 0)).toEqual(["hello world"]);
    expect(chunkText("hello world", -5)).toEqual(["hello world"]);
  });
});

describe("TelegramAdapter", () => {
  let mockBot: {
    on: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    api: { sendMessage: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    mockBot = {
      on: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      api: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    };
  });

  function createAdapter(channelId = "ch-test"): TelegramAdapter {
    return new TelegramAdapter(channelId, "fake-token", {
      createBot: () => mockBot as any,
    });
  }

  it("start registers message handler and starts bot", async () => {
    const adapter = createAdapter();
    const handler = vi.fn();
    mockBot.start.mockReturnValue(Promise.resolve());
    await adapter.start(handler);

    expect(mockBot.on).toHaveBeenCalledWith("message:text", expect.any(Function));
    expect(mockBot.start).toHaveBeenCalled();
  });

  it("start is idempotent — second call is a no-op", async () => {
    const adapter = createAdapter();
    mockBot.start.mockReturnValue(Promise.resolve());
    await adapter.start(vi.fn());
    await adapter.start(vi.fn());

    expect(mockBot.on).toHaveBeenCalledTimes(1);
    expect(mockBot.start).toHaveBeenCalledTimes(1);
  });

  it("message handler calls handler with InboundMessage for private chats", async () => {
    const adapter = createAdapter("ch-abc");
    const handler = vi.fn().mockResolvedValue(undefined);
    mockBot.start.mockReturnValue(Promise.resolve());
    await adapter.start(handler);

    // Get the registered callback
    const callback = mockBot.on.mock.calls[0][1];
    const ctx = {
      chat: { id: 12345, type: "private" },
      message: { text: "Hello", message_id: 99 },
      from: { id: 67890, username: "testuser" },
    };
    await callback(ctx);

    expect(handler).toHaveBeenCalledWith("ch-abc", {
      chatId: "12345",
      text: "Hello",
      messageId: "99",
      from: { id: "67890", username: "testuser" },
    });
  });

  it("message handler ignores non-private chats", async () => {
    const adapter = createAdapter();
    const handler = vi.fn();
    mockBot.start.mockReturnValue(Promise.resolve());
    await adapter.start(handler);

    const callback = mockBot.on.mock.calls[0][1];
    await callback({
      chat: { id: 1, type: "group" },
      message: { text: "Hi", message_id: 1 },
      from: { id: 1 },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("restart after stop reuses existing handlers", async () => {
    const adapter = createAdapter();
    const handler = vi.fn().mockResolvedValue(undefined);
    mockBot.start.mockReturnValue(Promise.resolve());
    await adapter.start(handler);
    await adapter.stop();
    // Second start should NOT re-register handlers (handlersRegistered=true, running=false)
    await adapter.start(handler);
    expect(mockBot.on).toHaveBeenCalledTimes(1); // handlers registered only once
    expect(mockBot.start).toHaveBeenCalledTimes(2); // but bot.start called twice
  });

  it("stop calls bot.stop()", async () => {
    const adapter = createAdapter();
    mockBot.start.mockReturnValue(Promise.resolve());
    await adapter.start(vi.fn());
    await adapter.stop();
    expect(mockBot.stop).toHaveBeenCalled();
  });

  it("stop is safe to call without start", async () => {
    const adapter = createAdapter();
    await adapter.stop();
    expect(mockBot.stop).not.toHaveBeenCalled();
  });

  it("sendText sends message via bot API", async () => {
    const adapter = createAdapter();
    await adapter.sendText("12345", "Hello!");
    expect(mockBot.api.sendMessage).toHaveBeenCalledWith("12345", "Hello!");
  });

  it("sendText chunks long messages", async () => {
    const adapter = createAdapter();
    const longText = "a".repeat(5000);
    await adapter.sendText("12345", longText);
    expect(mockBot.api.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("sendTyping sends typing action via bot API", async () => {
    const adapter = createAdapter();
    mockBot.api.sendChatAction = vi.fn().mockResolvedValue(undefined);
    await adapter.sendTyping("12345");
    expect(mockBot.api.sendChatAction).toHaveBeenCalledWith("12345", "typing");
  });

  it("channelId is set correctly", () => {
    const adapter = createAdapter("ch-xyz");
    expect(adapter.channelId).toBe("ch-xyz");
  });
});
