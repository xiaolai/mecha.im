import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { stopDaemon, meterDir } from "@mecha/meter";

export function registerStopDaemonCommand(program: Command, deps: CommandDeps): void {
  program
    .command("stop")
    .description("Stop all running bots, meter, and daemon")
    .option("--force", "Force kill bots instead of graceful stop", false)
    .action(async (opts: { force: boolean }) => withErrorHandler(deps, async () => {
      // Stop all running bots
      const running = deps.processManager.list().filter((p) => p.state === "running");

      if (running.length > 0) {
        deps.formatter.info(`Stopping ${running.length} running bot(s)...`);
        const results = await Promise.allSettled(
          running.map((p) =>
            opts.force
              ? deps.processManager.kill(p.name)
              : deps.processManager.stop(p.name),
          ),
        );

        let failures = 0;
        for (let i = 0; i < results.length; i++) {
          const r = results[i]!;
          if (r.status === "fulfilled") {
            deps.formatter.success(`Stopped ${running[i]!.name}`);
          } else {
            failures++;
            /* v8 ignore start -- non-Error rejection fallback */
            deps.formatter.error(`Failed to stop ${running[i]!.name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
            /* v8 ignore stop */
          }
        }
        if (failures > 0) {
          process.exitCode = 1;
        }
      }

      // Stop meter if running
      const dir = meterDir(deps.mechaDir);
      const meterStopped = stopDaemon(dir);
      if (meterStopped) {
        deps.formatter.success("Metering proxy stopped");
      }

      deps.formatter.success("Daemon stopped");
    }));
}
