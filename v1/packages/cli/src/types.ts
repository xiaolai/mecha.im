import type { ProcessManager } from "@mecha/process";
import type { Formatter } from "./output/formatter.js";

export interface CommandDeps {
  processManager: ProcessManager;
  formatter: Formatter;
}

/** Extract error message from unknown catch value */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
