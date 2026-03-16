import type { Command } from "commander";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { listBots } from "../store.js";
import { printTable } from "../cli-utils.js";

interface DayCost {
  totalCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

function readCosts(botPath: string): Record<string, DayCost> {
  try {
    return JSON.parse(readFileSync(join(botPath, "costs.json"), "utf-8"));
  } catch {
    return {};
  }
}

function sumCosts(costs: Record<string, DayCost>, days: string[]): number {
  return days.reduce((sum, day) => sum + (costs[day]?.totalCostUsd ?? 0), 0);
}

function getDateRange(period: string): string[] {
  const dates: string[] = [];
  const now = new Date();
  const count = period === "week" ? 7 : period === "month" ? 30 : 1;
  for (let i = 0; i < count; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export function registerCostsCommand(program: Command): void {
  program
    .command("costs [name]")
    .description("Show cost breakdown")
    .option("--period <period>", "Time period: today, week, month", "today")
    .option("--json", "Output as JSON")
    .action(async (name: string | undefined, opts) => {
      const bots = listBots();
      const botEntries = Object.entries(bots);
      const days = getDateRange(opts.period);
      const periodLabel = opts.period === "today" ? "today" : `last ${opts.period === "week" ? "7 days" : "30 days"}`;

      if (name) {
        // Single bot
        const entry = bots[name];
        if (!entry?.path) {
          console.error(`Bot "${name}" not found. Run "mecha ls" to see available bots.`);
          process.exit(1);
        }
        const costs = readCosts(entry.path);
        const total = sumCosts(costs, days);

        if (opts.json) {
          const detail = days.map(d => ({ date: d, cost: costs[d]?.totalCostUsd ?? 0 }));
          console.log(JSON.stringify({ bot: name, period: opts.period, total, days: detail }, null, 2));
          return;
        }

        console.log(`Costs for "${name}" (${periodLabel}): $${total.toFixed(2)}`);
        if (opts.period !== "today") {
          printTable(
            ["DATE", "COST"],
            days.filter(d => costs[d]).map(d => [d, `$${(costs[d]?.totalCostUsd ?? 0).toFixed(2)}`]),
          );
        }
        return;
      }

      // All bots
      const rows: Array<{ name: string; cost: number }> = [];
      let fleet = 0;
      for (const [botName, entry] of botEntries) {
        if (!entry.path) continue;
        const costs = readCosts(entry.path);
        const total = sumCosts(costs, days);
        rows.push({ name: botName, cost: total });
        fleet += total;
      }

      if (opts.json) {
        console.log(JSON.stringify({ period: opts.period, total: fleet, bots: rows }, null, 2));
        return;
      }

      if (rows.length === 0) {
        console.log("No bots found.");
        return;
      }

      rows.sort((a, b) => b.cost - a.cost);
      printTable(
        ["BOT", "COST"],
        rows.map(r => [r.name, `$${r.cost.toFixed(2)}`]),
      );
      console.log(`\nTotal (${periodLabel}): $${fleet.toFixed(2)}`);
    });
}
