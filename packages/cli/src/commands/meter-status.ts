import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { getMeterStatus, meterDir } from "@mecha/meter";
import { formatUptime } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

export function registerMeterStatusCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("status")
    .description("Show metering proxy status")
    .action(() =>
      withErrorHandler(deps, async () => {
        const dir = meterDir(deps.mechaDir);
        const status = getMeterStatus(dir);

        if (deps.formatter.isJson) {
          deps.formatter.json(status);
          return;
        }

        if (!status.running) {
          deps.formatter.info("Metering proxy: not running");
          deps.formatter.info("  Hint: run `mecha meter start` to enable cost tracking");
          return;
        }

        deps.formatter.info(`Metering proxy: running (pid ${status.pid}, port ${status.port})`);
        if (status.startedAt) {
          const started = new Date(status.startedAt);
          const uptimeMs = Date.now() - started.getTime();
          deps.formatter.info(`  Uptime:  ${formatUptime(Math.floor(uptimeMs / 1000))}`);
        }
        if (status.required) {
          deps.formatter.info("  Mode:    required (fail-closed)");
        }
      }),
    );
}

