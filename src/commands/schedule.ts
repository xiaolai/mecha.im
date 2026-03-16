import type { Command } from "commander";
import { requireValidName, printTable } from "../cli-utils.js";
import { botApiJson, botApiChecked } from "./bot-api.js";

interface ScheduleEntry {
  id: string;
  cron: string;
  prompt: string;
  paused?: boolean;
  last_run?: string;
  run_count?: number;
}

export function registerScheduleCommand(program: Command): void {
  const schedule = program
    .command("schedule <name>")
    .description("Manage bot schedules");

  schedule
    .command("ls")
    .description("List schedules")
    .option("--json", "Output as JSON")
    .action(async (opts, cmd) => {
      const name = cmd.parent.args[0];
      requireValidName(name);
      const schedules = await botApiJson<ScheduleEntry[]>(name, "/schedule");

      if (opts.json) {
        console.log(JSON.stringify(schedules, null, 2));
        return;
      }
      if (!Array.isArray(schedules) || schedules.length === 0) {
        console.log(`No schedules for "${name}".`);
        return;
      }
      printTable(
        ["ID", "CRON", "PROMPT", "STATUS", "RUNS"],
        schedules.map(s => [
          s.id.slice(0, 8),
          s.cron,
          s.prompt.length > 40 ? s.prompt.slice(0, 37) + "..." : s.prompt,
          s.paused ? "paused" : "active",
          String(s.run_count ?? 0),
        ]),
      );
    });

  schedule
    .command("add <cron> <prompt>")
    .description("Add a cron schedule")
    .action(async (cron: string, prompt: string, _opts, cmd) => {
      const name = cmd.parent.parent.args[0];
      requireValidName(name);
      const result = await botApiJson<{ id: string }>(name, "/schedule", {
        method: "POST",
        body: { cron, prompt },
      });
      console.log(`Schedule added: ${result.id}`);
    });

  schedule
    .command("rm <id>")
    .description("Remove a schedule")
    .action(async (id: string, _opts, cmd) => {
      const name = cmd.parent.parent.args[0];
      requireValidName(name);
      await botApiChecked(name, `/schedule/${id}`, { method: "DELETE" });
      console.log(`Schedule ${id} removed.`);
    });

  schedule
    .command("pause <id>")
    .description("Pause a schedule")
    .action(async (id: string, _opts, cmd) => {
      const name = cmd.parent.parent.args[0];
      requireValidName(name);
      await botApiChecked(name, `/schedule/${id}/pause`, { method: "POST" });
      console.log(`Schedule ${id} paused.`);
    });

  schedule
    .command("resume <id>")
    .description("Resume a paused schedule")
    .action(async (id: string, _opts, cmd) => {
      const name = cmd.parent.parent.args[0];
      requireValidName(name);
      await botApiChecked(name, `/schedule/${id}/resume`, { method: "POST" });
      console.log(`Schedule ${id} resumed.`);
    });

  schedule
    .command("run <id>")
    .description("Trigger a schedule immediately")
    .action(async (id: string, _opts, cmd) => {
      const name = cmd.parent.parent.args[0];
      requireValidName(name);
      await botApiChecked(name, `/schedule/trigger/${id}`, { method: "POST" });
      console.log(`Schedule ${id} triggered.`);
    });
}
