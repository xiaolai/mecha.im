import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";

export function registerRestartDaemonCommand(program: Command, deps: CommandDeps): void {
  program
    .command("restart")
    .description("Stop all CASAs and meter daemon")
    .option("--force", "Force kill CASAs instead of graceful stop", false)
    .option("--restart-casas", "Also restart CASAs that were running before stop", false)
    .action(async (opts: { force: boolean; restartCasas: boolean }) => withErrorHandler(deps, async () => {
      // Collect running CASAs before stopping (for --restart-casas)
      const wasRunning = opts.restartCasas
        ? deps.processManager.list().filter((p) => p.state === "running").map((p) => p.name)
        : [];

      // Stop all running CASAs
      const running = deps.processManager.list().filter((p) => p.state === "running");
      if (running.length > 0) {
        deps.formatter.info(`Stopping ${running.length} running CASA(s)...`);
        const results = await Promise.allSettled(
          running.map((p) =>
            opts.force
              ? deps.processManager.kill(p.name)
              : deps.processManager.stop(p.name),
          ),
        );
        for (let i = 0; i < results.length; i++) {
          const r = results[i]!;
          /* v8 ignore start -- stop rejection depends on process lifecycle race */
          if (r.status === "rejected") {
            deps.formatter.warn(`Failed to stop ${running[i]!.name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
            process.exitCode = 1;
          }
          /* v8 ignore stop */
        }
      }

      // Stop meter if running
      const { stopDaemon, meterDir } = await import("@mecha/meter");
      stopDaemon(meterDir(deps.mechaDir));

      deps.formatter.success("Daemon stopped");

      // Restart CASAs that were running if requested
      if (wasRunning.length > 0) {
        const { readCasaConfig } = await import("@mecha/core");
        const { join } = await import("node:path");
        deps.formatter.info(`Restarting ${wasRunning.length} CASA(s)...`);
        for (const name of wasRunning) {
          try {
            const config = readCasaConfig(join(deps.mechaDir, name));
            /* v8 ignore start -- config-missing fallback */
            if (!config) {
              deps.formatter.warn(`Skipping ${name}: no config found`);
              continue;
            }
            /* v8 ignore stop */
            const info = await deps.processManager.spawn({
              name,
              workspacePath: config.workspace,
              port: config.port,
              /* v8 ignore start -- auth nullish coalesce */
              auth: config.auth ?? undefined,
              /* v8 ignore stop */
              tags: config.tags,
              expose: config.expose,
              sandboxMode: config.sandboxMode,
              model: config.model,
              permissionMode: config.permissionMode,
            });
            deps.formatter.success(`Restarted ${info.name} on port ${info.port}`);
          /* v8 ignore start -- spawn error fallback */
          } catch (err) {
            deps.formatter.error(`Failed to restart ${name}: ${err instanceof Error ? err.message : String(err)}`);
          }
          /* v8 ignore stop */
        }
      }
    }));
}
