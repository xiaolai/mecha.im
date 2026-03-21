/**
 * Meter daemon lifecycle — thin wrapper around @mecha/meter.
 * Provides a convenience function for starting the meter proxy
 * from the agent server context.
 */
import { startDaemon, meterDir as getMeterDir } from "@mecha/meter";
import type { DaemonHandle } from "@mecha/meter";
import { DEFAULTS } from "@mecha/core";

/**
 * Start the meter proxy daemon in-process.
 * @param mechaDir - Path to ~/.mecha
 * @param port - Port to listen on (default: 7600)
 * @returns Handle with .close() and .info.port
 */
export async function startMeterDaemon(
  mechaDir: string,
  port = DEFAULTS.METER_PORT,
): Promise<DaemonHandle> {
  const dir = getMeterDir(mechaDir);
  return startDaemon({
    meterDir: dir,
    mechaDir,
    port,
    required: true,
  });
}
