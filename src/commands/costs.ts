import type { Command } from "commander";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { listBots } from "../store.js";
import { printTable } from "../cli-utils.js";

interface CostsData {
  today?: number;
  lifetime?: number;
  daily?: Record<string, number>;
}

function readCosts(botPath: string): CostsData {
  try {
    return JSON.parse(readFileSync(join(botPath, "costs.json"), "utf-8"));
  } catch {
    return {};
  }
}

function sumForPeriod(costs: CostsData, period: string): number {
  if (period === "today") return costs.today ?? 0;
  const daily = costs.daily ?? {};
  const days = getDateRange(period);
  return days.reduce((sum, day) => sum + (daily[day] ?? 0), 0);
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
      const periodLabel = opts.period === "today" ? "today" : `last ${opts.period === "week" ? "7 days" : "30 days"}`;

      if (name) {
        const entry = bots[name];
        if (!entry?.path) {
          console.error(`Bot "${name}" not found. Run "mecha ls" to see available bots.`);
          process.exit(1);
        }
        const costs = readCosts(entry.path);
        const total = sumForPeriod(costs, opts.period);

        if (opts.json) {
          const daily = costs.daily ?? {};
          const days = getDateRange(opts.period);
          const detail = days.map(d => ({ date: d, cost: daily[d] ?? 0 }));
          console.log(JSON.stringify({ bot: name, period: opts.period, total, lifetime: costs.lifetime ?? 0, days: detail }, null, 2));
          return;
        }

        console.log(`Costs for "${name}" (${periodLabel}): $${total.toFixed(2)} (lifetime: $${(costs.lifetime ?? 0).toFixed(2)})`);
        if (opts.period !== "today") {
          const daily = costs.daily ?? {};
          const days = getDateRange(opts.period);
          printTable(
            ["DATE", "COST"],
            days.filter(d => daily[d]).map(d => [d, `$${daily[d].toFixed(2)}`]),
          );
        }
        return;
      }

      // All bots
      const rows: Array<{ name: string; cost: number; lifetime: number }> = [];
      let fleet = 0;
      for (const [botName, entry] of botEntries) {
        if (!entry.path) continue;
        const costs = readCosts(entry.path);
        const total = sumForPeriod(costs, opts.period);
        rows.push({ name: botName, cost: total, lifetime: costs.lifetime ?? 0 });
        fleet += total;
      }

      if (opts.json) {
        console.log(JSON.stringify({ period: opts.period, total: fleet, bots: rows }, null, 2));
        return;
      }

      if (rows.length === 0) { console.log("No bots found."); return; }

      rows.sort((a, b) => b.cost - a.cost);
      printTable(
        ["BOT", "COST", "LIFETIME"],
        rows.map(r => [r.name, `$${r.cost.toFixed(2)}`, `$${r.lifetime.toFixed(2)}`]),
      );
      console.log(`\nTotal (${periodLabel}): $${fleet.toFixed(2)}`);
    });
}
