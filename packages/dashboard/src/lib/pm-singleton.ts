import type { ProcessManager } from "@mecha/process";
import type { AclEngine } from "@mecha/core";

let _pm: ProcessManager | undefined;
let _mechaDir: string | undefined;
let _acl: AclEngine | undefined;

export function setProcessManager(pm: ProcessManager, mechaDir: string, acl: AclEngine): void {
  _pm = pm;
  _mechaDir = mechaDir;
  _acl = acl;
}

export function getProcessManager(): ProcessManager {
  if (!_pm) throw new Error("ProcessManager not initialized — was startDashboard() called?");
  return _pm;
}

export function getMechaDir(): string {
  if (!_mechaDir) throw new Error("mechaDir not initialized — was startDashboard() called?");
  return _mechaDir;
}

export function getAcl(): AclEngine {
  if (!_acl) throw new Error("AclEngine not initialized — was startDashboard() called?");
  return _acl;
}

/** Minimal structured logger for dashboard API routes. */
export const log = {
  info(route: string, msg: string, data?: Record<string, unknown>) {
    console.info(JSON.stringify({ level: "info", route, msg, ...data, ts: new Date().toISOString() }));
  },
  warn(route: string, msg: string, data?: Record<string, unknown>) {
    console.warn(JSON.stringify({ level: "warn", route, msg, ...data, ts: new Date().toISOString() }));
  },
  error(route: string, msg: string, err?: unknown, data?: Record<string, unknown>) {
    const errMsg = err instanceof Error ? err.message : String(err ?? "");
    console.error(JSON.stringify({ level: "error", route, msg, error: errMsg, ...data, ts: new Date().toISOString() }));
  },
};
