import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/** Persisted CASA state — written to ~/.mecha/<name>/state.json */
export interface CasaState {
  name: string;
  state: "running" | "stopped" | "error";
  pid?: number;
  port?: number;
  workspacePath: string;
  startedAt?: string;
  stoppedAt?: string;
  exitCode?: number;
}

/** Read state.json from a CASA directory. Returns undefined if missing. */
export function readState(casaDir: string): CasaState | undefined {
  const statePath = join(casaDir, "state.json");
  if (!existsSync(statePath)) return undefined;
  try {
    const raw = readFileSync(statePath, "utf-8");
    return JSON.parse(raw) as CasaState;
  } catch {
    // Corrupted state file — treat as missing
    return undefined;
  }
}

/** Write state.json atomically (write to temp, rename). */
export function writeState(casaDir: string, state: CasaState): void {
  mkdirSync(casaDir, { recursive: true });
  const statePath = join(casaDir, "state.json");
  const tmp = statePath + `.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf-8");
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
