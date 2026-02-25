import { DEFAULTS } from "@mecha/core";
import type { NodeEntry } from "@mecha/core";

export interface AgentFetchOpts {
  node: NodeEntry;
  path: string;
  method?: string;
  body?: unknown;
  source?: string;
  signFn?: (data: Uint8Array) => Uint8Array;
  timeoutMs?: number;
}

/**
 * Make an authenticated HTTP request to a remote node's agent server.
 * Sets Bearer auth, optional X-Mecha-Source and X-Mecha-Signature headers.
 */
export async function agentFetch(opts: AgentFetchOpts): Promise<Response> {
  const { node, path, method = "GET", body, source, signFn, timeoutMs } = opts;
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
    const sig = signFn(new TextEncoder().encode(bodyStr));
    headers["x-mecha-signature"] = btoa(String.fromCharCode(...sig));
  }

  return fetch(url, {
    method,
    headers,
    body: bodyStr,
    signal: AbortSignal.timeout(timeoutMs ?? DEFAULTS.FORWARD_TIMEOUT_MS),
  });
}
