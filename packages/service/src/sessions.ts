import type { CasaName } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { runtimeFetch } from "./helpers.js";

export async function casaSessionList(
  pm: ProcessManager,
  name: CasaName,
): Promise<unknown[]> {
  const result = await runtimeFetch(pm, name, "/api/sessions");
  return result.body as unknown[];
}

export async function casaSessionGet(
  pm: ProcessManager,
  name: CasaName,
  sessionId: string,
): Promise<unknown> {
  const result = await runtimeFetch(pm, name, `/api/sessions/${sessionId}`);
  if (result.status === 404) return undefined;
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
  return result.body;
}

export async function casaSessionDelete(
  pm: ProcessManager,
  name: CasaName,
  sessionId: string,
): Promise<boolean> {
  const result = await runtimeFetch(pm, name, `/api/sessions/${sessionId}`, {
    method: "DELETE",
  });
  return result.status === 204;
}

export async function casaSessionRename(
  pm: ProcessManager,
  name: CasaName,
  sessionId: string,
  title: string,
): Promise<boolean> {
  const result = await runtimeFetch(pm, name, `/api/sessions/${sessionId}`, {
    method: "PATCH",
    body: { title },
  });
  return result.status === 200;
}

export async function casaSessionMessage(
  pm: ProcessManager,
  name: CasaName,
  sessionId: string,
  message: { role: "user" | "assistant"; content: string },
): Promise<unknown> {
  const result = await runtimeFetch(pm, name, `/api/sessions/${sessionId}/message`, {
    method: "POST",
    body: message,
  });
  return result.body;
}

export async function casaSessionInterrupt(
  pm: ProcessManager,
  name: CasaName,
  sessionId: string,
): Promise<boolean> {
  const result = await runtimeFetch(pm, name, `/api/sessions/${sessionId}/interrupt`, {
    method: "POST",
  });
  return result.status === 200;
}
