import { unlinkSync, lstatSync } from "node:fs";
import type { DockerClient } from "@mecha/docker";
import { inspectContainer } from "@mecha/docker";
import type {
  SessionCreateInputType,
  SessionListInputType,
  SessionGetInputType,
  SessionDeleteInputType,
  SessionMessageInputType,
  SessionInterruptInputType,
  SessionConfigUpdateInputType,
  SessionRenameInputType,
} from "@mecha/contracts";
import { SessionNotFoundError } from "@mecha/contracts";
import {
  containerName,
  LABELS,
  resolveProjectsDir,
  listSessionFiles,
  parseSessionSummary,
  parseSessionFile,
  setSessionMeta,
  getAllSessionMeta,
  deleteSessionMeta,
} from "@mecha/core";
import type {
  MechaId,
  SessionSummary,
  ParsedSession,
  SessionMeta,
} from "@mecha/core";
import { runtimeFetch } from "./helpers.js";

// ---------------------------------------------------------------------------
// Helper: get mecha project path from container labels (works when stopped)
// ---------------------------------------------------------------------------

export async function getMechaPath(client: DockerClient, mechaId: string): Promise<string> {
  const cName = containerName(mechaId as MechaId);
  const info = await inspectContainer(client, cName);
  const mechaPath = info.Config?.Labels?.[LABELS.MECHA_PATH];
  if (!mechaPath) {
    throw new Error(`Container ${cName} has no mecha.path label`);
  }
  return mechaPath;
}

// ---------------------------------------------------------------------------
// READ operations — filesystem-based (work when container is stopped)
// ---------------------------------------------------------------------------

export interface SessionListResult {
  sessions: SessionSummary[];
  meta: Record<string, SessionMeta>;
}

// --- mechaSessionList ---
export async function mechaSessionList(
  client: DockerClient,
  input: SessionListInputType,
): Promise<SessionListResult> {
  const mechaPath = await getMechaPath(client, input.id);
  const projectsDir = resolveProjectsDir(mechaPath);
  const files = listSessionFiles(projectsDir);
  const sessions = files.map((f) => parseSessionSummary(f.filePath));
  const meta = getAllSessionMeta(input.id);
  return { sessions, meta };
}

// --- mechaSessionGet ---
export async function mechaSessionGet(
  client: DockerClient,
  input: SessionGetInputType,
): Promise<ParsedSession> {
  const mechaPath = await getMechaPath(client, input.id);
  const projectsDir = resolveProjectsDir(mechaPath);
  const files = listSessionFiles(projectsDir);
  const match = files.find((f) => f.sessionId === input.sessionId);
  if (!match) throw new SessionNotFoundError(input.sessionId);
  return parseSessionFile(match.filePath);
}

// ---------------------------------------------------------------------------
// WRITE operations — runtime-based (require running container)
// ---------------------------------------------------------------------------

// --- mechaSessionCreate ---
export async function mechaSessionCreate(
  client: DockerClient,
  input: SessionCreateInputType,
): Promise<unknown> {
  const res = await runtimeFetch(client, input.id, "/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: input.title, config: input.config }),
  });
  return res.json();
}

// --- mechaSessionDelete ---
export async function mechaSessionDelete(
  client: DockerClient,
  input: SessionDeleteInputType,
): Promise<void> {
  // Delete the JSONL file on host
  const mechaPath = await getMechaPath(client, input.id);
  const projectsDir = resolveProjectsDir(mechaPath);
  const files = listSessionFiles(projectsDir);
  const match = files.find((f) => f.sessionId === input.sessionId);
  if (!match) throw new SessionNotFoundError(input.sessionId);

  // Reject symlinks to prevent deletion outside session tree
  const stat = lstatSync(match.filePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to delete symlinked session file: ${match.filePath}`);
  }
  unlinkSync(match.filePath);
  deleteSessionMeta(input.id, input.sessionId);

  // Best-effort runtime cleanup (container may be stopped)
  try {
    const sid = encodeURIComponent(input.sessionId);
    await runtimeFetch(client, input.id, `/api/sessions/${sid}`, {
      method: "DELETE",
      sessionId: input.sessionId,
    });
  } catch (err) {
    // Only ignore connection errors (container not running)
    const msg = err instanceof Error ? err.message : "";
    if (!msg.includes("ECONNREFUSED") && !msg.includes("fetch failed") && !msg.includes("not running")) {
      throw err;
    }
  }
}

// --- mechaSessionMessage ---
export async function mechaSessionMessage(
  client: DockerClient,
  input: SessionMessageInputType,
  signal?: AbortSignal,
): Promise<Response> {
  const sid = encodeURIComponent(input.sessionId);
  return runtimeFetch(client, input.id, `/api/sessions/${sid}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: input.message }),
    signal,
    sessionId: input.sessionId,
  });
}

// --- mechaSessionInterrupt ---
export async function mechaSessionInterrupt(
  client: DockerClient,
  input: SessionInterruptInputType,
): Promise<{ interrupted: boolean }> {
  const sid = encodeURIComponent(input.sessionId);
  const res = await runtimeFetch(client, input.id, `/api/sessions/${sid}/interrupt`, {
    method: "POST",
    sessionId: input.sessionId,
  });
  return res.json() as Promise<{ interrupted: boolean }>;
}

// --- mechaSessionRename ---
export async function mechaSessionRename(
  client: DockerClient,
  input: SessionRenameInputType,
): Promise<{ title: string }> {
  // Verify session exists before writing metadata
  const mechaPath = await getMechaPath(client, input.id);
  const projectsDir = resolveProjectsDir(mechaPath);
  const files = listSessionFiles(projectsDir);
  const match = files.find((f) => f.sessionId === input.sessionId);
  if (!match) throw new SessionNotFoundError(input.sessionId);

  setSessionMeta(input.id, input.sessionId, { customTitle: input.title });
  return { title: input.title };
}

// --- mechaSessionConfigUpdate ---
export async function mechaSessionConfigUpdate(
  client: DockerClient,
  input: SessionConfigUpdateInputType,
): Promise<unknown> {
  const sid = encodeURIComponent(input.sessionId);
  const res = await runtimeFetch(client, input.id, `/api/sessions/${sid}/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.config),
    sessionId: input.sessionId,
  });
  return res.json();
}
