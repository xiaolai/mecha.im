import type { ProcessManager } from "@mecha/process";
import type { AclEngine } from "@mecha/core";

// Use globalThis to share state across module instances.
// Next.js production builds bundle API routes separately from server-entry,
// creating different module instances of this file. Module-level variables
// would be isolated between the two copies. globalThis ensures both copies
// read/write the same singleton.

const G = globalThis as unknown as {
  __mecha_pm?: ProcessManager;
  __mecha_dir?: string;
  __mecha_acl?: AclEngine;
  __mecha_network_mode?: boolean;
  __mecha_session_ttl?: number;
};

export interface DashboardSingletonOpts {
  pm: ProcessManager;
  mechaDir: string;
  acl: AclEngine;
  networkMode?: boolean;
  sessionTtlHours?: number;
}

export function setProcessManager(pm: ProcessManager, mechaDir: string, acl: AclEngine, opts?: { networkMode?: boolean; sessionTtlHours?: number }): void {
  G.__mecha_pm = pm;
  G.__mecha_dir = mechaDir;
  G.__mecha_acl = acl;
  G.__mecha_network_mode = opts?.networkMode ?? false;
  G.__mecha_session_ttl = opts?.sessionTtlHours ?? 24;
}

export function getProcessManager(): ProcessManager {
  if (!G.__mecha_pm) throw new Error("ProcessManager not initialized — was startDashboard() called?");
  return G.__mecha_pm;
}

export function getMechaDir(): string {
  if (!G.__mecha_dir) throw new Error("mechaDir not initialized — was startDashboard() called?");
  return G.__mecha_dir;
}

export function getAcl(): AclEngine {
  if (!G.__mecha_acl) throw new Error("AclEngine not initialized — was startDashboard() called?");
  return G.__mecha_acl;
}

export function getNetworkMode(): boolean {
  return G.__mecha_network_mode ?? false;
}

export function getSessionTtlHours(): number {
  return G.__mecha_session_ttl ?? 24;
}

/** Minimal structured logger for dashboard API routes. */
export const log = {
  info(route: string, msg: string, data?: Record<string, unknown>) {
    // eslint-disable-next-line no-console
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
