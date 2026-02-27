import {
  writeFileSync,
  renameSync,
  mkdirSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { SandboxMode } from "@mecha/core";
import { safeReadJson, createLogger } from "@mecha/core";
import type { SandboxPlatform } from "@mecha/sandbox";

const log = createLogger("mecha:process");

/** Current state schema version — bump when shape changes */
export const STATE_VERSION = 1;

/** Persisted CASA state — written to ~/.mecha/<name>/state.json */
export interface CasaState {
  /** Schema version for forward-compatible reads */
  stateVersion?: number;
  name: string;
  state: "running" | "stopped" | "error";
  pid?: number;
  port?: number;
  workspacePath: string;
  startedAt?: string;
  stoppedAt?: string;
  exitCode?: number;
  sandboxPlatform?: SandboxPlatform;
  sandboxMode?: SandboxMode;
}

const CasaStateSchema: z.ZodType<CasaState> = z.object({
  stateVersion: z.number().optional(),
  name: z.string(),
  state: z.enum(["running", "stopped", "error"]),
  pid: z.number().optional(),
  port: z.number().optional(),
  workspacePath: z.string(),
  startedAt: z.string().optional(),
  stoppedAt: z.string().optional(),
  exitCode: z.number().optional(),
  sandboxPlatform: z.enum(["macos", "linux", "fallback"]).optional(),
  sandboxMode: z.enum(["auto", "off", "require"]).optional(),
});

/** Read state.json from a CASA directory. Returns undefined if missing. */
export function readState(casaDir: string): CasaState | undefined {
  const statePath = join(casaDir, "state.json");
  const result = safeReadJson(statePath, "CASA state", CasaStateSchema);
  if (!result.ok) {
    if (result.reason !== "missing") {
      log.warn(result.detail);
    }
    return undefined;
  }
  return result.data;
}

/** Write state.json atomically (write to temp, rename). Stamps stateVersion. */
export function writeState(casaDir: string, state: CasaState): void {
  mkdirSync(casaDir, { recursive: true });
  const statePath = join(casaDir, "state.json");
  const tmp = statePath + `.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const versioned = { ...state, stateVersion: STATE_VERSION };
  writeFileSync(tmp, JSON.stringify(versioned, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
  renameSync(tmp, statePath);
}

/** List all CASA directories under mechaDir/ (each with a state.json) */
export function listCasaDirs(mechaDir: string): string[] {
  if (!existsSync(mechaDir)) return [];
  return readdirSync(mechaDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(mechaDir, d.name))
    .filter((dir) => existsSync(join(dir, "state.json")));
}
