import type { Command } from "commander";
import { parsePort } from "../../shared/validation.js";
import { pc, success } from "../cli-output.js";

export function registerDaemonCommand(program: Command): void {
  const daemon = program
    .command("daemon")
    .description("Manage the mecha fleet daemon");

  daemon
    .command("start")
    .description("Start the fleet daemon")
    .option("--port <port>", "Listen port", "7700")
    .option("--host <host>", "Bind address", "127.0.0.1")
    .option("--background", "Run in background (detached)")
    .action(async (opts) => {
      const port = parsePort(opts.port);
      if (port === undefined) {
        console.error(`Invalid port: "${opts.port}"`);
        process.exit(1);
      }
      if (opts.background) {
        // Spawn detached child and exit parent immediately
        const { spawn: spawnChild } = await import("node:child_process");
        const { join } = await import("node:path");
        const { fileURLToPath } = await import("node:url");
        const cliPath = join(fileURLToPath(import.meta.url), "..", "..", "cli.js");
        const child = spawnChild(process.execPath, [cliPath, "daemon", "start", "--port", String(port), "--host", opts.host], {
          detached: true,
          stdio: "ignore",
          env: { ...process.env },
        });
        child.unref();
        console.log(`Daemon starting in background (PID ${child.pid})`);
        // Wait briefly for ready state
        const { readFileSync } = await import("node:fs");
        const { getMechaDir } = await import("../store.js");
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 500));
          try {
            const state = JSON.parse(readFileSync(join(getMechaDir(), "daemon.json"), "utf-8"));
            if (state?.status === "ready") {
              const h = state.host === "0.0.0.0" ? "localhost" : state.host;
              console.log(success(`Daemon running at http://${h}:${state.port}`));
              return;
            }
          } catch { /* not ready yet */ }
        }
        console.log("Daemon is starting... check status with: mecha daemon status");
        return;
      }
      const { startDaemon } = await import("../daemon.js");
      await startDaemon(port, opts.host, true);
    });

  daemon
    .command("stop")
    .description("Stop the fleet daemon")
    .action(async () => {
      const { stopDaemon } = await import("../daemon.js");
      const stopped = await stopDaemon();
      if (!stopped) process.exit(1);
    });

  daemon
    .command("status")
    .description("Show daemon status")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { getDaemonStatus, getDaemonUrl } = await import("../daemon.js");
      const { running, state } = getDaemonStatus();

      if (opts.json) {
        console.log(JSON.stringify({ running, ...state }, null, 2));
        return;
      }

      if (!running) {
        console.log("Daemon is " + pc.yellow("not running"));
        if (state) console.log(pc.dim(`  Stale state from PID ${state.pid} (started ${state.startedAt})`));
        return;
      }

      console.log(success("Daemon is running"));
      console.log(`  URL:     ${pc.cyan(getDaemonUrl() ?? "unknown")}`);
      console.log(`  PID:     ${state!.pid}`);
      console.log(`  Version: ${state!.version}`);
      console.log(`  Started: ${state!.startedAt}`);
    });
}
