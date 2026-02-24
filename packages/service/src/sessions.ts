import type { CasaName } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { runtimeFetch } from "./helpers.js";

function sessionPath(sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}`;
}

export async function casaSessionList(
  pm: ProcessManager,
  name: CasaName,
): Promise<unknown[]> {
  const result = await runtimeFetch(pm, name, "/api/sessions");
  if (result.status !== 200) throw new Error(`Failed to list sessions: ${result.status}`);
  return result.body as unknown[];
}

export async function casaSessionGet(
  pm: ProcessManager,
  name: CasaName,
  sessionId: string,
): Promise<unknown> {
  const result = await runtimeFetch(pm, name, sessionPath(sessionId));
  if (result.status === 404) return undefined;
  if (result.status !== 200) throw new Error(`Failed to get session: ${result.status}`);
  return result.body;
}

export async function casaSessionCreate(
  pm: ProcessManager,
  name: CasaName,
  opts?: { title?: string },
): Promise<unknown> {
  const result = await runtimeFetch(pm, name, "/api/sessions", {
    method: "POST",
    body: opts ?? {},
  });
  if (result.status !== 200) throw new Error(`Failed to create session: ${result.status}`);
  return result.body;
}

export async function casaSessionDelete(
  pm: ProcessManager,
  name: CasaName,
  sessionId: string,
): Promise<boolean> {
  const result = await runtimeFetch(pm, name, sessionPath(sessionId), {
    method: "DELETE",
  });
  if (result.status === 404) return false;
  if (result.status !== 204) throw new Error(`Failed to delete session: ${result.status}`);
  return true;
}

export async function casaSessionRename(
  pm: ProcessManager,
  name: CasaName,
  sessionId: string,
  title: string,
): Promise<boolean> {
  const result = await runtimeFetch(pm, name, sessionPath(sessionId), {
    method: "PATCH",
    body: { title },
  });
  if (result.status === 404) return false;
  if (result.status !== 200) throw new Error(`Failed to rename session: ${result.status}`);
  return true;
}

export async function casaSessionMessage(
  pm: ProcessManager,
  name: CasaName,
  sessionId: string,
  message: { role: "user" | "assistant"; content: string },
): Promise<unknown> {
  const event = {
    type: message.role,
    message: { role: message.role, content: message.content },
  };
  const result = await runtimeFetch(pm, name, `${sessionPath(sessionId)}/event`, {
    method: "POST",
    body: event,
  });
  if (result.status !== 200) throw new Error(`Failed to send message: ${result.status}`);
  return result.body;
}

export async function casaSessionInterrupt(
  pm: ProcessManager,
  name: CasaName,
  sessionId: string,
): Promise<boolean> {
  const result = await runtimeFetch(pm, name, `${sessionPath(sessionId)}/interrupt`, {
    method: "POST",
  });
  if (result.status === 409) return false;
  if (result.status !== 200) throw new Error(`Failed to interrupt session: ${result.status}`);
  return true;
}
