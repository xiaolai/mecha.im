import { writeFileSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { safeReadJson } from "./safe-read.js";

const SERVER_STATE_FILE = "server.json";

const ServerStateSchema = z.object({
  port: z.number().int().positive(),
  host: z.string(),
  publicAddr: z.string().optional(),
  startedAt: z.string(),
});

export type ServerState = z.infer<typeof ServerStateSchema>;

function statePath(mechaDir: string): string {
  return join(mechaDir, SERVER_STATE_FILE);
}

/** Read the embedded server state. Returns undefined if not running (file absent or corrupt). */
export function readServerState(mechaDir: string): ServerState | undefined {
  const result = safeReadJson(statePath(mechaDir), "server state", ServerStateSchema);
  if (!result.ok) return undefined;
  return result.data;
}

/** Write server state to disk (atomic: temp + rename, mode 0o600). */
export function writeServerState(mechaDir: string, state: ServerState): void {
  const path = statePath(mechaDir);
  const tmp = path + `.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

/** Remove server state file. Safe to call if file doesn't exist. */
export function removeServerState(mechaDir: string): void {
  try {
    unlinkSync(statePath(mechaDir));
  /* v8 ignore start -- ENOENT is fine, file already cleaned up */
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  /* v8 ignore stop */
}
