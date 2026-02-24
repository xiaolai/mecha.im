import { type CasaName, CasaNotFoundError } from "@mecha/core";
import type { ProcessManager, ProcessInfo } from "@mecha/process";

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
