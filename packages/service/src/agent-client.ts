import {
  NodeUnreachableError,
  NodeAuthFailedError,
  NodeRequestFailedError,
} from "@mecha/contracts";

/**
 * Duplicated from @mecha/agent to avoid circular dependency
 * (service cannot depend on agent). Keep in sync with agent/src/node-registry.ts.
 */
export interface NodeEntry {
  name: string;
  host: string;
  key: string;
}

export interface AgentFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/**
 * Fetch from a remote agent node.
 * Throws domain errors for network/auth/request failures.
 */
export async function agentFetch(
  node: NodeEntry,
  path: string,
  opts: AgentFetchOptions = {},
): Promise<Response> {
  const { timeoutMs = 10_000, method, headers: extraHeaders, body } = opts;
  const base = node.host.startsWith("http") ? node.host : `http://${node.host}`;
  const url = `${base}${path}`;
  const headers = new Headers(extraHeaders);
  headers.set("Authorization", `Bearer ${node.key}`);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body,
      ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
  } catch {
    throw new NodeUnreachableError(node.name);
  }
  if (res.status === 401) throw new NodeAuthFailedError(node.name);
  if (!res.ok) {
    throw new NodeRequestFailedError(node.name, res.status);
  }
  return res;
}
