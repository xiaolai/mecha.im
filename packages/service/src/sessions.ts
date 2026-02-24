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
