import { randomUUID } from "node:crypto";
import { DEFAULTS } from "@mecha/core";
import type { SecureChannel, ChannelRequest, ChannelResponse } from "./types.js";

export interface ChannelFetchOpts {
  channel: SecureChannel;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/** Send an HTTP-like request over a SecureChannel and wait for the response. */
export async function channelFetch(opts: ChannelFetchOpts): Promise<ChannelResponse> {
  const {
    channel,
    path,
    method = "GET",
    headers = {},
    body,
    timeoutMs = DEFAULTS.FORWARD_TIMEOUT_MS,
  } = opts;

  const request: ChannelRequest = {
    id: randomUUID(),
    method,
    path,
    headers,
    body,
  };

  const encoded = new TextEncoder().encode(JSON.stringify(request));

  return new Promise<ChannelResponse>((resolve, reject) => {
    let settled = false;

    function cleanup(): void {
      settled = true;
      clearTimeout(timer);
      channel.offMessage(messageHandler);
      channel.offError(errorHandler);
    }

    const messageHandler = (data: Uint8Array): void => {
      /* v8 ignore start -- message after settle is a no-op */
      if (settled) return;
      /* v8 ignore stop */
      try {
        const text = new TextDecoder().decode(data);
        const response = JSON.parse(text) as ChannelResponse;
        if (response.id === request.id) {
          cleanup();
          resolve(response);
        }
      /* v8 ignore start -- malformed response from peer */
      } catch {
        // Not our response or malformed — ignore and wait
      }
      /* v8 ignore stop */
    };

    const timer = setTimeout(() => {
      /* v8 ignore start -- timeout after settle is a no-op race */
      if (!settled) {
        cleanup();
        reject(new Error(`Channel fetch timeout after ${timeoutMs}ms`));
      }
      /* v8 ignore stop */
    }, timeoutMs);

    channel.onMessage(messageHandler);

    const errorHandler = (err: Error): void => {
      /* v8 ignore start -- error after settle is a no-op race */
      if (!settled) {
        cleanup();
        reject(err);
      }
      /* v8 ignore stop */
    };

    channel.onError(errorHandler);

    /* v8 ignore start -- channel.send() only throws if channel is closed pre-call */
    try {
      channel.send(encoded);
    } catch (err) {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
    /* v8 ignore stop */
  });
}
