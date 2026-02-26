import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ProxyInfo } from "./types.js";

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

/** Check if a pid is alive using kill -0 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Write proxy.json atomically (tmp + rename) */
export function writeProxyInfo(meterDir: string, info: ProxyInfo): void {
  mkdirSync(meterDir, { recursive: true });
  const target = join(meterDir, PROXY_JSON);
  const tmp = target + ".tmp";
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

  if (!isPidAlive(info.pid)) {
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
