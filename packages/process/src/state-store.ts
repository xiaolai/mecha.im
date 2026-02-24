import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";

/** Persisted CASA state — written to ~/.mecha/casas/<name>/state.json */
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
  const raw = readFileSync(statePath, "utf-8");
  return JSON.parse(raw) as CasaState;
}

/** Write state.json atomically (write to temp, rename). */
export function writeState(casaDir: string, state: CasaState): void {
  mkdirSync(casaDir, { recursive: true });
  const statePath = join(casaDir, "state.json");
  const tmp = statePath + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf-8");
  renameSync(tmp, statePath);
}

/** List all CASA directories under mechaDir/casas/ */
export function listCasaDirs(mechaDir: string): string[] {
  const casasDir = join(mechaDir, "casas");
  if (!existsSync(casasDir)) return [];
  return readdirSync(casasDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(casasDir, d.name));
}
