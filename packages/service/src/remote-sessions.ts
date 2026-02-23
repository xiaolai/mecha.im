import type { DockerClient } from "@mecha/docker";
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

export async function remoteSessionList(
  client: DockerClient,
  mechaId: string,
  target: RemoteTarget,
): Promise<SessionListResult> {
  if (target.node === "local") {
    return mechaSessionList(client, { id: mechaId });
  }
  const res = await agentFetch(target.entry!, `/mechas/${mechaId}/sessions`);
  return res.json() as Promise<SessionListResult>;
}

export async function remoteSessionGet(
  client: DockerClient,
  mechaId: string,
  sessionId: string,
  target: RemoteTarget,
): Promise<ParsedSession> {
  if (target.node === "local") {
    return mechaSessionGet(client, { id: mechaId, sessionId });
  }
  const sid = encodeURIComponent(sessionId);
  const res = await agentFetch(target.entry!, `/mechas/${mechaId}/sessions/${sid}`);
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
  const sid = encodeURIComponent(sessionId);
  await agentFetch(target.entry!, `/mechas/${mechaId}/sessions/${sid}/meta`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meta),
  });
}

export async function remoteSessionDelete(
  client: DockerClient,
  mechaId: string,
  sessionId: string,
  target: RemoteTarget,
): Promise<void> {
  if (target.node === "local") {
    return mechaSessionDelete(client, { id: mechaId, sessionId });
  }
  const sid = encodeURIComponent(sessionId);
  await agentFetch(target.entry!, `/mechas/${mechaId}/sessions/${sid}`, {
    method: "DELETE",
  });
}
