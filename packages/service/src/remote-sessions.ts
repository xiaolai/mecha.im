import type { ProcessManager } from "@mecha/process";
import type { NodeEntry } from "./agent-client.js";
import type { ParsedSession } from "@mecha/core";
import { setSessionMeta } from "@mecha/core";
import type { SessionListResult } from "./sessions.js";
import { mechaSessionList, mechaSessionGet, mechaSessionDelete } from "./sessions.js";
import { agentFetch } from "./agent-client.js";

export interface RemoteTarget {
  node: string;
  entry?: NodeEntry;
}

function requireEntry(target: RemoteTarget): NodeEntry {
  if (!target.entry) {
    throw new Error(`Remote target "${target.node}" is missing node entry`);
  }
  return target.entry;
}

export async function remoteSessionList(
  pm: ProcessManager,
  mechaId: string,
  target: RemoteTarget,
): Promise<SessionListResult> {
  if (target.node === "local") {
    return mechaSessionList(pm, { id: mechaId });
  }
  const mid = encodeURIComponent(mechaId);
  const res = await agentFetch(requireEntry(target), `/mechas/${mid}/sessions`);
  return res.json() as Promise<SessionListResult>;
}

export async function remoteSessionGet(
  pm: ProcessManager,
  mechaId: string,
  sessionId: string,
  target: RemoteTarget,
): Promise<ParsedSession> {
  if (target.node === "local") {
    return mechaSessionGet(pm, { id: mechaId, sessionId });
  }
  const mid = encodeURIComponent(mechaId);
  const sid = encodeURIComponent(sessionId);
  const res = await agentFetch(requireEntry(target), `/mechas/${mid}/sessions/${sid}`);
  return res.json() as Promise<ParsedSession>;
}

export async function remoteSessionMetaUpdate(
  mechaId: string,
  sessionId: string,
  meta: { customTitle?: string; starred?: boolean },
  target: RemoteTarget,
): Promise<void> {
  if (target.node === "local") {
    setSessionMeta(mechaId, sessionId, meta);
    return;
  }
  const mid = encodeURIComponent(mechaId);
  const sid = encodeURIComponent(sessionId);
  await agentFetch(requireEntry(target), `/mechas/${mid}/sessions/${sid}/meta`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meta),
  });
}

export async function remoteSessionDelete(
  pm: ProcessManager,
  mechaId: string,
  sessionId: string,
  target: RemoteTarget,
): Promise<void> {
  if (target.node === "local") {
    return mechaSessionDelete(pm, { id: mechaId, sessionId });
  }
  const mid = encodeURIComponent(mechaId);
  const sid = encodeURIComponent(sessionId);
  await agentFetch(requireEntry(target), `/mechas/${mid}/sessions/${sid}`, {
    method: "DELETE",
  });
}
