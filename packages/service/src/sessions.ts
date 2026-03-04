import { type BotName, SessionFetchError } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { runtimeFetch } from "./helpers.js";

function sessionPath(sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}`;
}

export async function botSessionList(
  pm: ProcessManager,
  name: BotName,
): Promise<unknown[]> {
  const result = await runtimeFetch(pm, name, "/api/sessions");
  if (result.status !== 200) throw new SessionFetchError("list", result.status);
  return result.body as unknown[];
}

export async function botSessionGet(
  pm: ProcessManager,
  name: BotName,
  sessionId: string,
): Promise<unknown> {
  const result = await runtimeFetch(pm, name, sessionPath(sessionId));
  if (result.status === 404) return undefined;
  if (result.status !== 200) throw new SessionFetchError("get", result.status);
  return result.body;
}

export async function botSessionDelete(
  pm: ProcessManager,
  name: BotName,
  sessionId: string,
): Promise<boolean> {
  const result = await runtimeFetch(pm, name, sessionPath(sessionId), { method: "DELETE" });
  if (result.status === 404) return false;
  if (result.status !== 200) throw new SessionFetchError("delete", result.status);
  return true;
}
