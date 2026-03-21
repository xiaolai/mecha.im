import { type BotName, BotNotFoundError, BotNotRunningError, MechaError, DEFAULTS } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";

/**
 * Resolves a running bot's port and auth token, or throws a typed error.
 */
export function resolveBotEndpoint(
  pm: ProcessManager,
  name: BotName,
): { port: number; token: string } {
  const info = pm.getPortAndToken(name);
  if (!info) {
    const processInfo = pm.get(name);
    if (processInfo) throw new BotNotRunningError(name);
    throw new BotNotFoundError(name);
  }
  return info;
}

/** Options for making an HTTP request to a bot's runtime server. */
export interface RuntimeFetchOpts {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Result of a runtime HTTP request, including parsed body and raw Response. */
export interface RuntimeFetchResult {
  status: number;
  body: unknown;
  raw: Response;
}

/**
 * Throws MechaError if the runtime response indicates failure (status >= 400).
 * Extracts error message from JSON body or falls back to a generic message.
 */
export function assertOk(result: RuntimeFetchResult, code: string): void {
  if (result.status >= 400) {
    const body = result.body as { error?: string };
    throw new MechaError(
      /* v8 ignore start -- fallback when error field missing */
      body?.error ?? `Request failed: ${result.status}`,
      /* v8 ignore stop */
      { code, statusCode: result.status, exitCode: 1 },
    );
  }
}

/**
 * Makes an HTTP request to a running bot's runtime server.
 * Resolves port and auth token from the ProcessManager.
 */
export async function runtimeFetch(
  pm: ProcessManager,
  name: BotName,
  path: string,
  opts: RuntimeFetchOpts = {},
): Promise<RuntimeFetchResult> {
  const info = resolveBotEndpoint(pm, name);

  const url = `http://127.0.0.1:${info.port}${path}`;
  const headers: Record<string, string> = {
    ...opts.headers,
    // Auth header applied last to prevent caller override
    authorization: `Bearer ${info.token}`,
  };

  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(DEFAULTS.FORWARD_TIMEOUT_MS),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  return { status: response.status, body, raw: response };
}
