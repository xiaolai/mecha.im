import { describe, it, expect, vi } from "vitest";
import { channelFetch } from "../src/channel-fetch.js";
import type { SecureChannel, ChannelResponse } from "../src/types.js";
import type { NodeName } from "@mecha/core";

function makeChannel(): SecureChannel & {
  _messageHandlers: Array<(data: Uint8Array) => void>;
  _errorHandlers: Array<(err: Error) => void>;
} {
  const ch = {
    peer: "bob" as NodeName,
    type: "hole-punched" as const,
    latencyMs: 42,
    peerFingerprint: "abc",
    isOpen: true,
    _messageHandlers: [] as Array<(data: Uint8Array) => void>,
    _errorHandlers: [] as Array<(err: Error) => void>,
    send: vi.fn(),
    onMessage(h: (data: Uint8Array) => void) { ch._messageHandlers.push(h); },
    offMessage(h: (data: Uint8Array) => void) {
      const idx = ch._messageHandlers.indexOf(h);
      if (idx >= 0) ch._messageHandlers.splice(idx, 1);
    },
    onClose: vi.fn(),
    onError(h: (err: Error) => void) { ch._errorHandlers.push(h); },
    offError(h: (err: Error) => void) {
      const idx = ch._errorHandlers.indexOf(h);
      if (idx >= 0) ch._errorHandlers.splice(idx, 1);
    },
    close: vi.fn(),
  };
  return ch;
}

describe("channelFetch", () => {
  it("sends request and resolves with matching response", async () => {
    const channel = makeChannel();

    // Intercept the sent request to get its ID
    let sentRequest: Record<string, unknown> | undefined;
    (channel.send as ReturnType<typeof vi.fn>).mockImplementation((data: Uint8Array) => {
      sentRequest = JSON.parse(new TextDecoder().decode(data));
    });

    const promise = channelFetch({
      channel,
      path: "/api/test",
      method: "POST",
      body: '{"data":"value"}',
      timeoutMs: 5000,
    });

    // Wait for send to be called
    await new Promise((r) => setTimeout(r, 10));

    // Simulate response from peer
    const response: ChannelResponse = {
      id: sentRequest!.id as string,
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"ok":true}',
    };
    const responseBytes = new TextEncoder().encode(JSON.stringify(response));
    for (const h of channel._messageHandlers) h(responseBytes);

    const result = await promise;
    expect(result.status).toBe(200);
    expect(result.body).toBe('{"ok":true}');
    expect(result.id).toBe(sentRequest!.id);
  });

  it("rejects on timeout", async () => {
    const channel = makeChannel();

    const promise = channelFetch({
      channel,
      path: "/api/slow",
      timeoutMs: 50,
    });

    await expect(promise).rejects.toThrow("timeout");
  });

  it("rejects on channel error", async () => {
    const channel = makeChannel();

    const promise = channelFetch({
      channel,
      path: "/api/error",
      timeoutMs: 5000,
    });

    // Wait for handlers to be registered
    await new Promise((r) => setTimeout(r, 10));

    for (const h of channel._errorHandlers) h(new Error("connection lost"));

    await expect(promise).rejects.toThrow("connection lost");
  });

  it("ignores responses with non-matching id", async () => {
    const channel = makeChannel();

    let sentRequest: Record<string, unknown> | undefined;
    (channel.send as ReturnType<typeof vi.fn>).mockImplementation((data: Uint8Array) => {
      sentRequest = JSON.parse(new TextDecoder().decode(data));
    });

    const promise = channelFetch({
      channel,
      path: "/api/test",
      timeoutMs: 5000,
    });

    await new Promise((r) => setTimeout(r, 10));

    // Send a response with a different ID — should be ignored
    const wrongResponse: ChannelResponse = {
      id: "wrong-id",
      status: 200,
      headers: {},
    };
    for (const h of channel._messageHandlers) h(new TextEncoder().encode(JSON.stringify(wrongResponse)));

    // Now send the correct response
    const correctResponse: ChannelResponse = {
      id: sentRequest!.id as string,
      status: 200,
      headers: {},
      body: "ok",
    };
    for (const h of channel._messageHandlers) h(new TextEncoder().encode(JSON.stringify(correctResponse)));

    const result = await promise;
    expect(result.body).toBe("ok");
  });

  it("uses GET method by default", async () => {
    const channel = makeChannel();
    let sentMethod: string | undefined;
    (channel.send as ReturnType<typeof vi.fn>).mockImplementation((data: Uint8Array) => {
      const parsed = JSON.parse(new TextDecoder().decode(data));
      sentMethod = parsed.method;
    });

    const promise = channelFetch({
      channel,
      path: "/healthz",
      timeoutMs: 5000,
    });

    await new Promise((r) => setTimeout(r, 10));

    // Respond
    const response: ChannelResponse = {
      id: (JSON.parse(new TextDecoder().decode(
        (channel.send as ReturnType<typeof vi.fn>).mock.calls[0]![0],
      )) as Record<string, unknown>).id as string,
      status: 200,
      headers: {},
    };
    for (const h of channel._messageHandlers) h(new TextEncoder().encode(JSON.stringify(response)));

    await promise;
    expect(sentMethod).toBe("GET");
  });
});
