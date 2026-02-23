import { stat } from "node:fs/promises";
import type { ProcessManager } from "@mecha/process";
import {
  PathNotFoundError,
  PathNotDirectoryError,
  InvalidPermissionModeError,
  NoPortBindingError,
  TokenNotFoundError,
  SessionNotFoundError,
  SessionBusyError,
  SessionCapReachedError,
} from "@mecha/contracts";
import { PERMISSION_MODES } from "@mecha/contracts";

/** Validate path exists and is a directory. */
export async function validateProjectPath(projectPath: string): Promise<void> {
  let st;
  try {
    st = await stat(projectPath);
  } catch {
    throw new PathNotFoundError(projectPath);
  }
  if (!st.isDirectory()) throw new PathNotDirectoryError(projectPath);
}

/** Validate permission mode. */
export function validatePermissionMode(mode: string | undefined): void {
  if (mode !== undefined && !(PERMISSION_MODES as readonly string[]).includes(mode)) {
    throw new InvalidPermissionModeError(mode);
  }
}

/** Get runtime URL and auth token for a mecha. */
export async function getRuntimeAccess(pm: ProcessManager, mechaId: string): Promise<{ url: string; token: string }> {
  const { port, env } = pm.getPortAndEnv(mechaId);
  if (!port) throw new NoPortBindingError(mechaId);
  const token = env.MECHA_AUTH_TOKEN;
  if (!token) throw new TokenNotFoundError(mechaId);
  return { url: `http://127.0.0.1:${port}`, token };
}

/** Map runtime session error status codes to domain errors. */
export function mapSessionError(status: number, body: string, sessionId?: string): Error {
  if (status === 404) return new SessionNotFoundError(sessionId ?? "unknown");
  if (status === 409) return new SessionBusyError(sessionId ?? "unknown");
  if (status === 429) return new SessionCapReachedError();
  if (status === 400) return new Error(`Bad request: ${body}`);
  if (status === 503) return new Error(`Service unavailable: ${body}`);
  return new Error(`Session request failed: ${status} ${body}`);
}

/** Fetch from a mecha's runtime API with auth, error mapping, and default timeout.
 *  Pass `signal: undefined` explicitly to disable the default 30s timeout (for streaming). */
export async function runtimeFetch(
  pm: ProcessManager,
  mechaId: string,
  path: string,
  init: RequestInit & { sessionId?: string } = {},
): Promise<Response> {
  const { url, token } = await getRuntimeAccess(pm, mechaId);
  const { sessionId, ...fetchInit } = init;
  // Only apply default timeout if caller did not explicitly provide a signal key
  const hasExplicitSignal = "signal" in init;
  // Use Headers API to guarantee auth cannot be overridden (case-insensitive dedup)
  const headers = new Headers(fetchInit.headers as Record<string, string>);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${url}${path}`, {
    ...fetchInit,
    headers,
    signal: hasExplicitSignal ? fetchInit.signal : AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw mapSessionError(res.status, await res.text(), sessionId);
  return res;
}
