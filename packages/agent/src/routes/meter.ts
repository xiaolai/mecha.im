import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { join } from "node:path";
import { DEFAULTS } from "@mecha/core";
import { queryCostToday, queryCostForBot, getMeterStatus, startDaemon, stopDaemon, type DaemonHandle } from "@mecha/meter";

/** Options for metering/cost route registration. */
export interface MeterRouteOpts {
  mechaDir: string;
}

/** Per-mechaDir handles so start/stop manage the correct in-process daemon. */
const daemonHandles = new Map<string, DaemonHandle>();

/** Start meter daemon in-process. Returns the handle or throws. */
export async function startMeterDaemon(mechaDir: string, port?: number): Promise<DaemonHandle> {
  const meterDir = join(mechaDir, "meter");
  const handle = await startDaemon({ meterDir, mechaDir, port: port ?? DEFAULTS.METER_PORT, required: false });
  daemonHandles.set(mechaDir, handle);
  return handle;
}

/** Stop meter daemon. Returns true if stopped. */
export async function stopMeterDaemon(mechaDir: string): Promise<boolean> {
  const handle = daemonHandles.get(mechaDir);
  if (handle) {
    await handle.close();
    daemonHandles.delete(mechaDir);
    return true;
  }
  // Fallback: stop external daemon via PID signal
  const meterDir = join(mechaDir, "meter");
  return stopDaemon(meterDir);
}

/** Register meter routes: cost, status, start, stop. */
export function registerMeterRoutes(app: FastifyInstance, opts: MeterRouteOpts): void {
  const meterDir = join(opts.mechaDir, "meter");

  app.get("/meter/cost", async (request: FastifyRequest<{ Querystring: { bot?: string } }>) => {
    const bot = request.query.bot;
    return bot
      ? queryCostForBot(meterDir, bot)
      : queryCostToday(meterDir);
  });

  app.get("/meter/status", async () => {
    return getMeterStatus(meterDir);
  });

  app.post("/meter/start", async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const handle = await startMeterDaemon(opts.mechaDir);
      return { ok: true, port: handle.info.port, pid: handle.info.pid };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.code(409).send({ error: message });
    }
  });

  app.post("/meter/stop", async (_request: FastifyRequest, reply: FastifyReply) => {
    const stopped = await stopMeterDaemon(opts.mechaDir);
    if (!stopped) {
      reply.code(404).send({ error: "Meter proxy not running" });
      return;
    }
    return { ok: true };
  });
}
