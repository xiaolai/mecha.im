import { type BotName, SessionFetchError } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { runtimeFetch } from "./helpers.js";

function sessionPath(sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}`;
}

/** List all sessions for a running bot. */
export async function botSessionList(
  pm: ProcessManager,
  name: BotName,
): Promise<unknown[]> {
  const result = await runtimeFetch(pm, name, "/api/sessions");
  if (result.status !== 200) throw new SessionFetchError("list", result.status);
  return result.body as unknown[];
}

/** Get a single session by ID, or undefined if not found. */
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

/** Delete a session by ID. Returns true if deleted, false if not found. */
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
