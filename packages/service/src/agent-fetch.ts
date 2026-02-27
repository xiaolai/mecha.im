import { DEFAULTS, validateRemoteHost, ConnectError } from "@mecha/core";
import type { NodeEntry } from "@mecha/core";

/** Minimal SecureChannel interface (avoids importing @mecha/connect as a dependency). */
export interface SecureChannelLike {
  readonly isOpen: boolean;
  send(data: Uint8Array): void;
  onMessage(handler: (data: Uint8Array) => void): void;
  offMessage(handler: (data: Uint8Array) => void): void;
  onError?(handler: (err: Error) => void): void;
  offError?(handler: (err: Error) => void): void;
  onClose?(handler: (reason: string) => void): void;
}

export interface AgentFetchOpts {
  node: NodeEntry;
  path: string;
  method?: string;
  body?: unknown;
  source?: string;
  signFn?: (data: Uint8Array) => Uint8Array;
  timeoutMs?: number;
  /** Allow private/loopback hosts (for local dev/testing). Default: false. */
  allowPrivateHosts?: boolean;
  /** Use existing SecureChannel instead of raw HTTP (Phase 6) */
  channel?: SecureChannelLike;
}

/**
 * Make an authenticated HTTP request to a remote node's agent server.
 * Sets Bearer auth, optional X-Mecha-Source and X-Mecha-Signature headers.
 *
 * If a SecureChannel is provided and open, tunnels the request over the
 * encrypted channel instead of making a raw HTTP call.
 */
export async function agentFetch(opts: AgentFetchOpts): Promise<Response> {
  const { node, path, method = "GET", body, source, signFn, timeoutMs, allowPrivateHosts, channel } = opts;

  // Phase 6: tunnel over SecureChannel if available
  if (channel?.isOpen) {
    return channelBasedFetch(channel, { method, path, body, source, timeoutMs });
  }

  // Managed nodes MUST use SecureChannel — no HTTP fallback
  if (node.managed) {
    throw new ConnectError(`Managed node "${node.name}" requires SecureChannel (not connected)`);
  }

  if (!allowPrivateHosts) validateRemoteHost(node.host);
  const url = `http://${node.host}:${node.port}${path}`;

  const headers: Record<string, string> = {
    authorization: `Bearer ${node.apiKey}`,
  };

  if (source) {
    headers["x-mecha-source"] = source;
  }

  let bodyStr: string | undefined;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    bodyStr = JSON.stringify(body);
  }

  if (signFn && bodyStr) {
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    headers["x-mecha-timestamp"] = timestamp;
    headers["x-mecha-nonce"] = nonce;
    // Sign canonical envelope matching auth.ts verifier contract
    const envelope = `${method}\n${path}\n${source ?? ""}\n${timestamp}\n${nonce}\n${bodyStr}`;
    const sig = signFn(new TextEncoder().encode(envelope));
    headers["x-mecha-signature"] = btoa(String.fromCharCode(...sig));
  }

  return fetch(url, {
    method,
    headers,
    body: bodyStr,
    signal: AbortSignal.timeout(timeoutMs ?? DEFAULTS.FORWARD_TIMEOUT_MS),
  });
}

/** Send an HTTP-like request over a SecureChannel (Phase 6). */
async function channelBasedFetch(
  channel: SecureChannelLike,
  opts: { method: string; path: string; body?: unknown; source?: string; timeoutMs?: number },
): Promise<Response> {
  const { method, path, body, source, timeoutMs = DEFAULTS.FORWARD_TIMEOUT_MS } = opts;

  const request = {
    id: crypto.randomUUID(),
    method,
    path,
    headers: source ? { "x-mecha-source": source } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };

  const encoded = new TextEncoder().encode(JSON.stringify(request));

  return new Promise<Response>((resolve, reject) => {
    let settled = false;

    function cleanup(): void {
      settled = true;
      clearTimeout(timer);
      channel.offMessage(messageHandler);
      /* v8 ignore start -- offError cleanup for optional channel method */
      if (channel.offError) channel.offError(errorHandler);
      /* v8 ignore stop */
    }

    /* v8 ignore start -- channel error/close handlers for early rejection */
    const errorHandler = (err: Error): void => {
      if (!settled) {
        cleanup();
        reject(err);
      }
    };

    const closeHandler = (_reason: string): void => {
      if (!settled) {
        cleanup();
        reject(new Error("Channel closed before response received"));
      }
    };
    /* v8 ignore stop */

    const messageHandler = (data: Uint8Array): void => {
      /* v8 ignore start -- message after settle is a no-op */
      if (settled) return;
      /* v8 ignore stop */
      try {
        const text = new TextDecoder().decode(data);
        const response = JSON.parse(text) as { id: string; status: number; headers: Record<string, string>; body?: string };
        if (response.id === request.id) {
          cleanup();
          resolve(new Response(response.body ?? null, {
            status: response.status,
            headers: response.headers,
          }));
        }
      /* v8 ignore start -- malformed response from peer */
      } catch {
        // Not our response — wait for the right one
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
    /* v8 ignore start -- register error/close for early rejection */
    if (channel.onError) channel.onError(errorHandler);
    if (channel.onClose) channel.onClose(closeHandler);
    /* v8 ignore stop */
    channel.send(encoded);
  });
}
