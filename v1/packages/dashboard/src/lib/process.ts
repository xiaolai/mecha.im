import { createProcessManager } from "@mecha/process";
import type { ProcessManager } from "@mecha/process";

let pm: ProcessManager | undefined;

export function getProcessManager(): ProcessManager {
  if (!pm) {
    pm = createProcessManager();
  }
  return pm;
}
