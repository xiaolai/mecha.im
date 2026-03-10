import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { isPidAlive } from "@mecha/core";
import type { ProxyInfo } from "./types.js";

// Re-export from canonical source in @mecha/core
export { isPidAlive } from "@mecha/core";

const PROXY_JSON = "proxy.json";

/** Read proxy.json, returning null if missing or corrupt */
export function readProxyInfo(meterDir: string): ProxyInfo | null {
  try {
    const raw = readFileSync(join(meterDir, PROXY_JSON), "utf-8");
    const info = JSON.parse(raw) as ProxyInfo;
    if (typeof info.port !== "number" || typeof info.pid !== "number") {
      return null;
    }
    return info;
  } catch {
    return null;
  }
}

/** Write proxy.json atomically (tmp + rename) */
export function writeProxyInfo(meterDir: string, info: ProxyInfo): void {
  mkdirSync(meterDir, { recursive: true });
  const target = join(meterDir, PROXY_JSON);
  const tmp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(info, null, 2) + "\n");
  renameSync(tmp, target);
}

/** Delete proxy.json */
export function deleteProxyInfo(meterDir: string): void {
  try {
    unlinkSync(join(meterDir, PROXY_JSON));
  } catch (err: unknown) {
    /* v8 ignore start -- only ENOENT expected */
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[mecha:meter] Failed to delete proxy.json:", (err as Error).message);
    }
    /* v8 ignore stop */
  }
}

/**
 * Check if a PID belongs to a mecha process (guards against PID reuse).
 * On Linux, reads /proc/<pid>/cmdline. On other platforms, returns true (optimistic).
 */
export function isPidMecha(pid: number): boolean {
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
    return cmdline.includes("mecha");
  } catch {
    // /proc not available (macOS) or PID gone — assume valid on macOS, dead if ENOENT
    return isPidAlive(pid);
  }
}

/** Clean stale proxy.json if pid is dead. Returns true if cleaned. */
export function cleanStaleProxy(meterDir: string): boolean {
  const info = readProxyInfo(meterDir);
  if (!info) return false;
  if (!isPidAlive(info.pid)) {
    deleteProxyInfo(meterDir);
    return true;
  }
  return false;
}

export interface MeterStatus {
  running: boolean;
  port?: number;
  pid?: number;
  required?: boolean;
  startedAt?: string;
}

/** Get current meter proxy status */
export function getMeterStatus(meterDir: string): MeterStatus {
  const info = readProxyInfo(meterDir);
  if (!info) return { running: false };

  if (!isPidMecha(info.pid)) {
    deleteProxyInfo(meterDir);
    return { running: false };
  }

  return {
    running: true,
    port: info.port,
    pid: info.pid,
    required: info.required,
    startedAt: info.startedAt,
  };
}
