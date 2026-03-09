import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { MeterProxyNotRunningError } from "@mecha/core";
import { stopDaemon, meterDir } from "@mecha/meter";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'meter stop' subcommand. */
export function registerMeterStopCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("stop")
    .description("Stop the metering proxy")
    .action(() =>
      withErrorHandler(deps, async () => {
        const dir = meterDir(deps.mechaDir);
        const sent = stopDaemon(dir);

        if (!sent) {
          throw new MeterProxyNotRunningError();
        }

        deps.formatter.success("Metering proxy stopped");
      }),
    );
}
