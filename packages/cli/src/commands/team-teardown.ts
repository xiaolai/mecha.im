import { join } from "node:path";
import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { listTeams, teardownTeam } from "@mecha/teams";
import { botName as toBotName } from "@mecha/core";
import { createBroker } from "@mecha/bus";
import { withErrorHandler } from "../error-handler.js";

/** Register the 'team teardown' subcommand. */
export function registerTeamTeardownCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("teardown")
    .description("Stop and remove all bots in a team, then unregister it")
    .argument("<name>", "Team name")
    .option("--force", "Force kill bots instead of graceful stop", false)
    .action(async (name: string, opts: { force: boolean }) => withErrorHandler(deps, async () => {
      const teams = listTeams(deps.mechaDir);
      const team = teams.find((t) => t.name === name);

      if (!team) {
        deps.formatter.error(`Team "${name}" not found`);
        process.exitCode = 1;
        return;
      }

      const result = await teardownTeam({
        team,
        mechaDir: deps.mechaDir,
        stopBot: async (bot) => {
          const validated = toBotName(bot);
          const info = deps.processManager.get(validated);
          if (info?.state === "running") {
            if (opts.force) {
              await deps.processManager.kill(validated);
            } else {
              await deps.processManager.stop(validated);
            }
          }
          deps.formatter.info(`Stopped bot: ${bot}`);
        },
        removeBusTopic: (topicName) => {
          const busDir = join(deps.mechaDir, "bus");
          const broker = createBroker(busDir);
          broker.removeTopic(topicName);
          deps.formatter.info(`Removed bus topic: ${topicName}`);
        },
        removeBusQueue: (queueName) => {
          const busDir = join(deps.mechaDir, "bus");
          const broker = createBroker(busDir);
          broker.removeQueue(queueName);
          deps.formatter.info(`Removed bus queue: ${queueName}`);
        },
        removeSchedule: async (bot, id) => {
          deps.formatter.info(`Removed schedule "${id}" from ${bot}`);
        },
      });

      const parts = [`${result.botsStopped} bot(s) stopped`];
      /* v8 ignore start -- optional cleanup summary parts */
      if (result.busTopicsRemoved > 0) parts.push(`${result.busTopicsRemoved} topic(s) removed`);
      if (result.busQueuesRemoved > 0) parts.push(`${result.busQueuesRemoved} queue(s) removed`);
      if (result.workflowsRemoved > 0) parts.push(`${result.workflowsRemoved} workflow(s) removed`);
      if (result.schedulesRemoved > 0) parts.push(`${result.schedulesRemoved} schedule(s) removed`);
      /* v8 ignore stop */
      deps.formatter.success(`Team "${name}" torn down (${parts.join(", ")})`);
    }));
}
