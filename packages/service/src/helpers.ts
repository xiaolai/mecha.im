import type { CasaName } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { CasaNotFoundError, CasaNotRunningError } from "@mecha/contracts";

export interface RuntimeFetchOpts {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface RuntimeFetchResult {
  status: number;
  body: unknown;
  raw: Response;
}

/**
 * Makes an HTTP request to a running CASA's runtime server.
 * Resolves port and auth token from the ProcessManager.
 */
export async function runtimeFetch(
  pm: ProcessManager,
  name: CasaName,
  path: string,
  opts: RuntimeFetchOpts = {},
): Promise<RuntimeFetchResult> {
  const info = pm.getPortAndToken(name);
  if (!info) {
    // Check if CASA exists but is stopped, or doesn't exist at all
    const processInfo = pm.get(name);
    if (processInfo) {
      throw new CasaNotRunningError(name);
    }
    throw new CasaNotFoundError(name);
  }

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
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  return { status: response.status, body, raw: response };
}
