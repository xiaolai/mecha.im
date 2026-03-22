/**
 * Task operation HTTP helpers — talk to the agent server's /tasks API.
 * Used by CLI commands and MCP tools.
 */
import type { Task, TaskCreateInput } from "@mecha/core";

/** Create a task on the agent server. Returns the task ID. */
export async function taskCreate(
  agentUrl: string,
  auth: string,
  input: TaskCreateInput,
): Promise<{ id: string; status: string }> {
  const res = await fetch(`${agentUrl}/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(auth) },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return await res.json() as { id: string; status: string };
}

/** Get a task by ID from the agent server. */
export async function taskGet(
  agentUrl: string,
  auth: string,
  id: string,
): Promise<Task> {
  const res = await fetch(`${agentUrl}/tasks/${encodeURIComponent(id)}`, {
    headers: authHeaders(auth),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return await res.json() as Task;
}

/** Cancel a task on the agent server. */
export async function taskCancel(
  agentUrl: string,
  auth: string,
  id: string,
): Promise<void> {
  const res = await fetch(`${agentUrl}/tasks/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(auth) },
    body: "{}",
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

/** List tasks from the agent server with optional filters. */
export async function taskList(
  agentUrl: string,
  auth: string,
  opts?: { target?: string; status?: string },
): Promise<Task[]> {
  const params = new URLSearchParams();
  if (opts?.target) params.set("target", opts.target);
  if (opts?.status) params.set("status", opts.status);
  const qs = params.toString();
  const url = `${agentUrl}/tasks${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    headers: authHeaders(auth),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return await res.json() as Task[];
}

/** Build auth headers from a token string. Supports Bearer token or session cookie. */
function authHeaders(auth: string): Record<string, string> {
  if (auth.startsWith("mecha-session=")) {
    return { cookie: auth };
  }
  return { authorization: `Bearer ${auth}` };
}
