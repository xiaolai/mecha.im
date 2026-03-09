import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { DEFAULTS } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";
import { readDaemonPid, isDaemonRunning } from "../daemon.js";
import { AgentClient, detectAgentPort } from "../client.js";

/** Register the 'status' command. */
export function registerStatusCommand(program: Command, deps: CommandDeps): void {
  program
    .command("status")
    .description("Show daemon, server, and bot status")
    .option("--port <port>", "Agent server port", String(DEFAULTS.AGENT_PORT))
    .action(async (opts: { port: string }) => withErrorHandler(deps, async () => {
      // Detect port from agent.json or use option
      const detectedPort = detectAgentPort(deps.mechaDir);
      const port = detectedPort ?? (parseInt(opts.port, 10) || DEFAULTS.AGENT_PORT);
      const client = new AgentClient(port);
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
