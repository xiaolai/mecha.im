import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { DEFAULTS } from "./constants.js";

/** Dashboard-only metadata for a session (stars, custom titles). */
export interface SessionMeta {
  customTitle?: string;
  starred?: boolean;
}

type MetaStore = Record<string, Record<string, SessionMeta>>;

function metaFilePath(): string {
  return join(homedir(), DEFAULTS.HOME_DIR, "session-meta.json");
}

function readStore(): MetaStore {
  try {
    const raw = readFileSync(metaFilePath(), "utf-8");
    return JSON.parse(raw) as MetaStore;
  } catch {
    return {};
  }
}

function writeStore(store: MetaStore): void {
  const fp = metaFilePath();
  const dir = dirname(fp);
  mkdirSync(dir, { recursive: true });
  // Atomic write: write to temp file, then rename
  const tmp = join(dir, `.session-meta.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
  renameSync(tmp, fp);
}

/** Get metadata for a specific session. */
export function getSessionMeta(mechaId: string, sessionId: string): SessionMeta {
  const store = readStore();
  return store[mechaId]?.[sessionId] ?? {};
}

/** Set (merge) metadata for a specific session. Removes keys set to undefined. */
export function setSessionMeta(mechaId: string, sessionId: string, meta: Partial<SessionMeta>): void {
  const store = readStore();
  if (!store[mechaId]) store[mechaId] = {};
  const existing = store[mechaId][sessionId] ?? {};
  const merged = { ...existing, ...meta };
  // Clean undefined values
  for (const key of Object.keys(merged) as (keyof SessionMeta)[]) {
    if (merged[key] === undefined) delete merged[key];
  }
  if (Object.keys(merged).length === 0) {
    delete store[mechaId][sessionId];
    if (Object.keys(store[mechaId]).length === 0) delete store[mechaId];
  } else {
    store[mechaId][sessionId] = merged;
  }
  writeStore(store);
}

/** Get all session metadata for a given mecha. */
export function getAllSessionMeta(mechaId: string): Record<string, SessionMeta> {
  const store = readStore();
  return store[mechaId] ?? {};
}

/** Delete metadata for a specific session. No-op if it doesn't exist. */
export function deleteSessionMeta(mechaId: string, sessionId: string): void {
  const store = readStore();
  if (!store[mechaId]?.[sessionId]) return;
  delete store[mechaId][sessionId];
  if (Object.keys(store[mechaId]).length === 0) delete store[mechaId];
  writeStore(store);
}
