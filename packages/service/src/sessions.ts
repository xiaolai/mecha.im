import { openSync, readSync, closeSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { type BotName, SessionFetchError, readBotConfig } from "@mecha/core";
import type { ProcessManager } from "@mecha/process";
import { encodeProjectPath } from "@mecha/process";
import { runtimeFetch } from "./helpers.js";

function sessionPath(sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}`;
}

/** Valid session ID pattern (matches Claude Code format). */
const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;

/** Read bounded prefix of a file (avoids reading entire large transcripts). */
function readPrefix(filePath: string, maxBytes = 4096): string {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, "r");
    const buf = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buf, 0, maxBytes, 0);
    return buf.toString("utf-8", 0, bytesRead);
  /* v8 ignore start -- IO errors on prefix read */
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  /* v8 ignore stop */
}

/** Extract title from transcript prefix, supporting multiple formats. */
function extractTitle(prefix: string): string | undefined {
  const line = prefix.split("\n").find((l) => l.includes('"type":"user"'));
  if (!line) return undefined;
  try {
    const parsed = JSON.parse(line) as { message?: string | { content?: string | unknown[] } };
    // Direct string message form
    if (typeof parsed.message === "string") return parsed.message.slice(0, 80);
    const content = parsed.message?.content;
    if (typeof content === "string") return content.slice(0, 80);
    // Structured content array: [{ type: "text", text: "..." }, ...]
    if (Array.isArray(content)) {
      const text = content.find((c): c is { text: string } => typeof c === "object" && c !== null && "text" in c);
      if (text) return text.text.slice(0, 80);
    }
  /* v8 ignore start -- best-effort title extraction */
  } catch { /* ignore parse errors */ }
  /* v8 ignore stop */
  return undefined;
}

/** Read session list from disk (works regardless of bot state). */
export function botSessionListFromDisk(mechaDir: string, name: BotName): unknown[] {
  const botDir = join(mechaDir, name);
  const config = readBotConfig(botDir);
  if (!config?.workspace) return [];

  const homeDir = config.home ?? botDir;
  const projectsDir = join(homeDir, ".claude", "projects", encodeProjectPath(config.workspace));

  let entries: string[];
  try {
    entries = readdirSync(projectsDir);
  /* v8 ignore start -- directory may not exist for new bots */
  } catch {
    return [];
  }
  /* v8 ignore stop */

  // Collect .meta.json metadata keyed by session ID
  const metaMap = new Map<string, { title?: string; starred?: boolean; createdAt?: string; updatedAt?: string }>();
  for (const entry of entries) {
    if (!entry.endsWith(".meta.json")) continue;
    const id = entry.slice(0, -10); // strip .meta.json
    if (!SESSION_ID_RE.test(id)) continue;
    try {
      const raw = readFileSync(join(projectsDir, entry), "utf-8");
      const meta = JSON.parse(raw) as Record<string, unknown>;
      metaMap.set(id, {
        title: typeof meta.title === "string" ? meta.title : undefined,
        starred: typeof meta.starred === "boolean" ? meta.starred : undefined,
        createdAt: typeof meta.createdAt === "string" ? meta.createdAt : undefined,
        updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : undefined,
      });
    /* v8 ignore start -- corrupt meta files */
    } catch { /* skip */ }
    /* v8 ignore stop */
  }

  const sessions: { id: string; createdAt?: string; updatedAt?: string; title?: string; starred?: boolean }[] = [];
  const seen = new Set<string>();

  // Process .jsonl files (primary session indicator)
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const id = entry.slice(0, -6); // strip .jsonl
    if (!SESSION_ID_RE.test(id)) continue;
    seen.add(id);
    const filePath = join(projectsDir, entry);
    try {
      const stats = statSync(filePath);
      const meta = metaMap.get(id);
      // Prefer meta title, fall back to transcript prefix extraction
      const title = meta?.title ?? extractTitle(readPrefix(filePath));
      sessions.push({
        id,
        createdAt: meta?.createdAt ?? stats.birthtime.toISOString(),
        updatedAt: meta?.updatedAt ?? stats.mtime.toISOString(),
        title,
        starred: meta?.starred,
      });
    /* v8 ignore start -- stat errors for individual files */
    } catch { /* skip unreadable files */ }
    /* v8 ignore stop */
  }

  // Include sessions that have .meta.json but no .jsonl (edge case)
  for (const [id, meta] of metaMap) {
    if (seen.has(id)) continue;
    sessions.push({ id, ...meta });
  }

  // Most recently updated first
  sessions.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return sessions;
}

/** List all sessions for a bot. Uses runtime API when running, falls back to disk. */
export async function botSessionList(
  pm: ProcessManager,
  name: BotName,
  mechaDir?: string,
): Promise<unknown[]> {
  const info = pm.get(name);
  if (info?.state === "running") {
    try {
      const result = await runtimeFetch(pm, name, "/api/sessions");
      if (result.status === 200) return result.body as unknown[];
      // Non-200 from runtime (e.g. bot starting up) — fall through to disk.
      // This is intentional: listing is best-effort, disk provides a usable fallback.
    /* v8 ignore start -- connection errors fall through to disk */
    } catch { /* connectivity error — fall through to disk-based read */ }
    /* v8 ignore stop */
  }
  if (mechaDir) return botSessionListFromDisk(mechaDir, name);
  return [];
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
