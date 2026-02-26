import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { MeterProxyAlreadyRunningError, PortConflictError } from "@mecha/core";
import {
  readProxyInfo, isPidAlive, writeProxyInfo, deleteProxyInfo,
} from "./lifecycle.js";
import { initPricing, loadPricing } from "./pricing.js";
import { handleProxyRequest, reloadBudgets, type ProxyContext } from "./proxy.js";
import { scanCasaRegistry } from "./registry.js";
import { readBudgets } from "./budgets.js";
import { createHotCounters, fromSnapshot } from "./hot-counters.js";
import { readSnapshot, writeSnapshot } from "./snapshot.js";
import { toSnapshot } from "./hot-counters.js";
import { todayUTC } from "./query.js";
import type { ProxyInfo } from "./types.js";

export interface DaemonOpts {
  meterDir: string;
  mechaDir?: string;
  port: number;
  required: boolean;
}

export interface DaemonHandle {
  server: Server;
  info: ProxyInfo;
  close: () => Promise<void>;
}

/** Start the metering proxy daemon. Throws if already running or port busy. */
export async function startDaemon(opts: DaemonOpts): Promise<DaemonHandle> {
  const { meterDir, port, required } = opts;

  // Single instance check
  const existing = readProxyInfo(meterDir);
  if (existing && isPidAlive(existing.pid)) {
    throw new MeterProxyAlreadyRunningError(existing.pid);
  }
  // Clean stale proxy.json
  if (existing) {
    deleteProxyInfo(meterDir);
  }

  // Initialize pricing.json if not present
  initPricing(meterDir);

  const info: ProxyInfo = {
    port,
    pid: process.pid,
    required,
    startedAt: new Date().toISOString(),
  };

  // Build proxy context with hot counters and budgets
  const mechaParent = opts.mechaDir ?? meterDir.replace(/\/meter$/, "");
  const date = todayUTC();
  const snapshot = readSnapshot(meterDir);
  const counters = snapshot && snapshot.date === date ? fromSnapshot(snapshot) : createHotCounters(date);

  const ctx: ProxyContext = {
    meterDir,
    pricing: loadPricing(meterDir),
    registry: scanCasaRegistry(mechaParent),
    counters,
    budgets: readBudgets(meterDir),
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handleProxyRequest(req, res, ctx);
  });

  // Periodic snapshot flush (every 5 seconds)
  const snapshotTimer = setInterval(() => {
    try { writeSnapshot(meterDir, toSnapshot(ctx.counters)); } catch { /* best-effort */ }
  }, 5_000);
  snapshotTimer.unref();

  // Periodic registry rescan (every 30 seconds)
  const registryTimer = setInterval(() => {
    ctx.registry = scanCasaRegistry(mechaParent);
  }, 30_000);
  registryTimer.unref();

  // SIGHUP: reload budgets + pricing
  const sighupHandler = () => {
    reloadBudgets(ctx);
    ctx.pricing = loadPricing(meterDir);
    ctx.registry = scanCasaRegistry(mechaParent);
  };
  process.on("SIGHUP", sighupHandler);

  return new Promise<DaemonHandle>((resolve, reject) => {
    server.on("error", (err: NodeJS.ErrnoException) => {
      /* v8 ignore start -- only EADDRINUSE is testable; other server errors are runtime-only */
      if (err.code === "EADDRINUSE") {
        reject(new PortConflictError(port));
      } else {
        reject(err);
      }
      /* v8 ignore stop */
    });

    server.listen(port, "127.0.0.1", () => {
      // Update port to actual bound port (important when port=0)
      const addr = server.address();
      /* v8 ignore start -- server.address() is always AddressInfo for TCP listeners */
      if (typeof addr === "object" && addr) {
        info.port = addr.port;
      }
      /* v8 ignore stop */
      writeProxyInfo(meterDir, info);

      const close = async (): Promise<void> => {
        clearInterval(snapshotTimer);
        clearInterval(registryTimer);
        process.removeListener("SIGHUP", sighupHandler);
        // Flush final snapshot before shutdown
        try { writeSnapshot(meterDir, toSnapshot(ctx.counters)); } catch { /* best-effort */ }
        return new Promise<void>((res) => {
          server.close(() => {
            deleteProxyInfo(meterDir);
            res();
          });
        });
      };

      resolve({ server, info, close });
    });
  });
}

/**
 * Stop a running proxy by sending SIGTERM.
 * Returns true if signal was sent, false if not running.
 */
export function stopDaemon(meterDir: string): boolean {
  const info = readProxyInfo(meterDir);
  if (!info) return false;

  if (!isPidAlive(info.pid)) {
    deleteProxyInfo(meterDir);
    return false;
  }

  try {
    process.kill(info.pid, "SIGTERM");
    return true;
  } catch {
    /* v8 ignore start -- race: pid dies between check and kill */
    deleteProxyInfo(meterDir);
    return false;
    /* v8 ignore stop */
  }
}

/** Get the meter directory path: ~/.mecha/meter */
export function meterDir(mechaDir: string): string {
  return join(mechaDir, "meter");
}
