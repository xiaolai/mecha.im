import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { DEFAULTS } from "@mecha/core";
import { startDaemon, meterDir } from "@mecha/meter";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'meter start' subcommand. */
export function registerMeterStartCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("start")
    .description("Start metering proxy daemon")
    .option("-p, --port <number>", "Port to listen on", String(DEFAULTS.METER_PORT))
    .option("--required", "Require metering for spawn (fail-closed)", false)
    .action((opts: { port: string; required: boolean }) =>
      withErrorHandler(deps, async () => {
        const port = parseInt(opts.port, 10);
        if (!Number.isFinite(port) || port < 0 || port > 65535) {
          deps.formatter.error(`Invalid port: ${opts.port}`);
          process.exitCode = 1;
          return;
        }

        const dir = meterDir(deps.mechaDir);
        const handle = await startDaemon({ meterDir: dir, port, required: opts.required });

        if (deps.registerShutdownHook) {
          deps.registerShutdownHook(async () => handle.close());
        }

        if (deps.formatter.isJson) {
          deps.formatter.json({ port: handle.info.port, pid: handle.info.pid });
        } else {
          deps.formatter.success(`Metering proxy started on 127.0.0.1:${handle.info.port}`);
        }
      }),
    );
}
