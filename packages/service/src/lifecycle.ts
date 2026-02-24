import type { CasaName } from "@mecha/core";
import type { ProcessManager, ProcessInfo, SpawnOpts, LogOpts } from "@mecha/process";
import { CasaNotFoundError } from "@mecha/contracts";
import type { Readable } from "node:stream";

export async function casaSpawn(
  pm: ProcessManager,
  opts: SpawnOpts,
): Promise<ProcessInfo> {
  return pm.spawn(opts);
}

export function casaLs(pm: ProcessManager): ProcessInfo[] {
  return pm.list();
}

export function casaStatus(
  pm: ProcessManager,
  name: CasaName,
): ProcessInfo {
  const info = pm.get(name);
  if (!info) {
    throw new CasaNotFoundError(name);
  }
  return info;
}

export async function casaKill(
  pm: ProcessManager,
  name: CasaName,
): Promise<void> {
  return pm.kill(name);
}

export async function casaStop(
  pm: ProcessManager,
  name: CasaName,
): Promise<void> {
  return pm.stop(name);
}

export function casaLogs(
  pm: ProcessManager,
  name: CasaName,
  opts?: LogOpts,
): Readable {
  return pm.logs(name, opts);
}
