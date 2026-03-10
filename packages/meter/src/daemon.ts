import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { MeterProxyAlreadyRunningError, PortConflictError, createLogger, DEFAULTS } from "@mecha/core";
import {
  readProxyInfo, isPidAlive, writeProxyInfo, deleteProxyInfo, isPidMecha,
} from "./lifecycle.js";
import { initPricing, loadPricing } from "./pricing.js";
import { handleProxyRequest, reloadBudgets, getDroppedEventCount, type ProxyContext } from "./proxy.js";
import { scanBotRegistry } from "./registry.js";
import { readBudgets } from "./budgets.js";
import { cleanupOldEvents } from "./events.js";
import { createHotCounters, fromSnapshot, resetToday, resetMonth, toSnapshot } from "./hot-counters.js";
import { readSnapshot, writeSnapshot } from "./snapshot.js";
import { todayUTC, monthFromDate } from "./query.js";
import type { ProxyInfo } from "./types.js";

const log = createLogger("mecha:meter");

/** Timing-safe string comparison that doesn't leak length info via early return. */
function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against itself to spend constant time, then return false
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export interface DaemonOpts {
  meterDir: string;
  mechaDir?: string;
  port: number;
  required: boolean;
  /** Bearer token for meter proxy auth. If set, requests must include Authorization header. */
  authToken?: string;
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
  const mechaParent = opts.mechaDir ?? join(meterDir, "..");
  const date = todayUTC();
  const snapshot = readSnapshot(meterDir);
  const counters = snapshot && snapshot.date === date ? fromSnapshot(snapshot) : createHotCounters(date);

  const ctx: ProxyContext = {
    meterDir,
    pricing: loadPricing(meterDir),
    registry: scanBotRegistry(mechaParent),
    counters,
    budgets: readBudgets(meterDir),
    pendingRequests: new Map(),
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Auth check: if authToken is configured, verify Bearer token (timing-safe)
    if (opts.authToken) {
      const authHeader = req.headers.authorization ?? "";
      // Parse scheme case-insensitively (RFC 7235 §2.1)
      const spaceIdx = authHeader.indexOf(" ");
      const scheme = spaceIdx > 0 ? authHeader.slice(0, spaceIdx).toLowerCase() : "";
      const token = spaceIdx > 0 ? authHeader.slice(spaceIdx + 1) : "";
      if (scheme !== "bearer" || !timingSafeCompare(token, opts.authToken)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }
    try {
      handleProxyRequest(req, res, ctx);
    /* v8 ignore start -- uncaught request handler exception */
    } catch (err) {
      log.error("Unhandled request error", { error: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      if (!res.writableEnded) {
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
    /* v8 ignore stop */
  });

  // Periodic snapshot flush + day rollover check (every 5 seconds)
  const snapshotTimer = setInterval(() => {
    try {
      const now = todayUTC();
      /* v8 ignore start -- day/month rollover: reset functions tested in hot-counters.test.ts; timer tested via snapshot flush */
      if (now !== ctx.counters.date) {
        if (monthFromDate(now) !== monthFromDate(ctx.counters.date)) {
          resetMonth(ctx.counters, now);
        } else {
          resetToday(ctx.counters, now);
        }
        // Clean up event files older than 90 days on day rollover
        cleanupOldEvents(meterDir, 90);
      }
      /* v8 ignore stop */
      const snap = toSnapshot(ctx.counters);
      snap.droppedEvents = getDroppedEventCount();
      writeSnapshot(meterDir, snap);
    /* v8 ignore start -- snapshot flush error in timer callback */
    } catch (err) {
      log.error("Snapshot flush failed", { error: err instanceof Error ? err.message : String(err) });
    }
    /* v8 ignore stop */
  }, DEFAULTS.METER_SNAPSHOT_INTERVAL_MS);
  snapshotTimer.unref();

  // Periodic registry rescan (every 30 seconds)
  const registryTimer = setInterval(() => {
    ctx.registry = scanBotRegistry(mechaParent);
  }, 30_000);
  registryTimer.unref();

  // SIGHUP: reload budgets + pricing
  const sighupHandler = () => {
    reloadBudgets(ctx);
    ctx.pricing = loadPricing(meterDir);
    ctx.registry = scanBotRegistry(mechaParent);
  };
  process.on("SIGHUP", sighupHandler);

  return new Promise<DaemonHandle>((resolve, reject) => {
    server.on("error", (err: NodeJS.ErrnoException) => {
      // Clean up timers/listeners on startup failure
      clearInterval(snapshotTimer);
      clearInterval(registryTimer);
      process.removeListener("SIGHUP", sighupHandler);
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
        try {
          const finalSnap = toSnapshot(ctx.counters);
          finalSnap.droppedEvents = getDroppedEventCount();
          writeSnapshot(meterDir, finalSnap);
        } catch { /* best-effort */ }
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
 * Verifies process identity via startedAt to prevent PID reuse attacks.
 */
export function stopDaemon(meterDir: string): boolean {
  const info = readProxyInfo(meterDir);
  if (!info) return false;

  if (!isPidAlive(info.pid)) {
    deleteProxyInfo(meterDir);
    return false;
  }

  // Guard against PID reuse: verify the process is actually a mecha process
  if (!isPidMecha(info.pid)) {
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
