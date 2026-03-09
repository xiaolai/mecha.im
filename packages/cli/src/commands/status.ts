import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { DEFAULTS, parsePort } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";
import { readDaemonPid, isDaemonRunning } from "../daemon.js";
import { AgentClient, detectAgent } from "../client.js";

/** Register the 'status' command. */
export function registerStatusCommand(program: Command, deps: CommandDeps): void {
  program
    .command("status")
    .description("Show daemon, server, and bot status")
    .option("--port <port>", "Agent server port")
    .action(async (opts: { port?: string }) => withErrorHandler(deps, async () => {
      // Explicit --port takes precedence; fall back to agent.json auto-discovery
      if (opts.port && !parsePort(opts.port)) {
        deps.formatter.error(`Invalid port: ${opts.port}`);
        process.exitCode = 1;
        return;
      }
      const explicitPort = opts.port ? parsePort(opts.port) : undefined;
      const detected = detectAgent(deps.mechaDir);
      const port = explicitPort ?? detected?.port ?? DEFAULTS.AGENT_PORT;
      const host = detected?.host ?? "127.0.0.1";
      const client = new AgentClient(port, host);
      const alive = await client.isAlive();

      // Daemon status
      const daemonPid = readDaemonPid(deps.mechaDir);
      const daemonRunning = isDaemonRunning(deps.mechaDir);

      if (deps.formatter.isJson) {
        const bots = deps.processManager.list();
        deps.formatter.json({
          daemon: { pid: daemonPid, running: daemonRunning },
          server: { alive, port },
          bots: bots.map(b => ({
            name: b.name, state: b.state, port: b.port, workspace: b.workspacePath,
          })),
        });
        return;
      }

      // Human-readable output
      if (daemonRunning) {
        deps.formatter.success(`Daemon running (pid ${daemonPid})`);
      } else if (daemonPid) {
        deps.formatter.warn(`Stale daemon PID file (pid ${daemonPid}, process dead)`);
      } else {
        deps.formatter.info("Daemon not running");
      }

      if (alive) {
        deps.formatter.success(`Server listening on port ${port}`);
      } else {
        deps.formatter.warn(`Server not reachable on port ${port}`);
      }

      // Bot list from ProcessManager (filesystem state)
      const bots = deps.processManager.list();
      if (bots.length === 0) {
        deps.formatter.info("No bots configured");
      } else {
        deps.formatter.table(
          ["Name", "State", "Port", "Workspace"],
          bots.map(b => [b.name, b.state, String(b.port ?? "—"), b.workspacePath ?? "—"]),
        );
      }
    }));
}
