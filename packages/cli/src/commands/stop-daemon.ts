import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";
import { stopDaemon, meterDir } from "@mecha/meter";
import { readDaemonPid, removeDaemonPid } from "../daemon.js";
import { unlinkSync } from "node:fs";
import { join } from "node:path";

/** Register the 'stop' command (stop daemon). */
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

      // Kill daemon process if running
      const daemonPid = readDaemonPid(deps.mechaDir);
      if (daemonPid !== null && daemonPid !== process.pid) {
        try {
          process.kill(daemonPid, "SIGTERM");
          removeDaemonPid(deps.mechaDir);
          deps.formatter.success(`Daemon process stopped (pid ${daemonPid})`);
        /* v8 ignore start -- ESRCH expected if daemon already exited */
        } catch {
          removeDaemonPid(deps.mechaDir); // stale PID file
        }
        /* v8 ignore stop */
      } else if (daemonPid === process.pid) {
        // We ARE the daemon — clean up PID file (process will exit after this)
        removeDaemonPid(deps.mechaDir);
      }

      // Clean up agent discovery file
      /* v8 ignore start -- agent.json may not exist */
      try { unlinkSync(join(deps.mechaDir, "agent.json")); } catch { /* ignore */ }
      /* v8 ignore stop */

      deps.formatter.success("Daemon stopped");
    }));
}
