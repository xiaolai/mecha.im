import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { meterDir, readBudgets, writeBudgets, setBudget, removeBudget } from "@mecha/meter";
import { withErrorHandler } from "../error-handler.js";

export function registerBudgetCommand(program: Command, deps: CommandDeps): void {
  const budget = program
    .command("budget")
    .description("Manage API cost budgets");

  budget
    .command("set")
    .description("Set a budget limit")
    .argument("[name]", "CASA name (omit with --global, --auth, or --tag)")
    .option("--global", "Set global budget")
    .option("--auth <profile>", "Set budget for auth profile")
    .option("--tag <tag>", "Set budget for tag")
    .option("--daily <amount>", "Daily USD limit")
    .option("--monthly <amount>", "Monthly USD limit")
    .action((name?: string, opts?: { global?: boolean; auth?: string; tag?: string; daily?: string; monthly?: string }) =>
      withErrorHandler(deps, async () => {
        /* v8 ignore start -- Commander always passes opts */
        const o = opts ?? {};
        /* v8 ignore stop */
        const daily = o.daily ? parseFloat(o.daily) : undefined;
        const monthly = o.monthly ? parseFloat(o.monthly) : undefined;

        if (daily === undefined && monthly === undefined) {
          deps.formatter.error("Specify --daily <amount> and/or --monthly <amount>");
          process.exitCode = 1;
          return;
        }

        let target: { type: "global" } | { type: "casa"; name: string } | { type: "auth"; name: string } | { type: "tag"; name: string };
        if (o.global) {
          target = { type: "global" };
        } else if (o.auth) {
          target = { type: "auth", name: o.auth };
        } else if (o.tag) {
          target = { type: "tag", name: o.tag };
        } else if (name) {
          target = { type: "casa", name };
        } else {
          deps.formatter.error("Specify a CASA name or use --global, --auth <name>, --tag <name>");
          process.exitCode = 1;
          return;
        }

        const dir = meterDir(deps.mechaDir);
        const config = readBudgets(dir);
        setBudget(config, target, daily, monthly);
        writeBudgets(dir, config);
        deps.formatter.success(`Budget set for ${target.type === "global" ? "global" : target.name}`);
      }),
    );

  budget
    .command("rm")
    .description("Remove a budget limit")
    .argument("[name]", "CASA name (omit with --global, --auth, or --tag)")
    .option("--global", "Remove global budget")
    .option("--auth <profile>", "Remove budget for auth profile")
    .option("--tag <tag>", "Remove budget for tag")
    .option("--daily", "Remove daily limit")
    .option("--monthly", "Remove monthly limit")
    .action((name?: string, opts?: { global?: boolean; auth?: string; tag?: string; daily?: boolean; monthly?: boolean }) =>
      withErrorHandler(deps, async () => {
        /* v8 ignore start -- Commander always passes opts */
        const o = opts ?? {};
        /* v8 ignore stop */
        const field = o.daily ? "daily" as const : o.monthly ? "monthly" as const : null;
        if (!field) {
          deps.formatter.error("Specify --daily or --monthly");
          process.exitCode = 1;
          return;
        }

        let target: { type: "global" } | { type: "casa"; name: string } | { type: "auth"; name: string } | { type: "tag"; name: string };
        if (o.global) {
          target = { type: "global" };
        } else if (o.auth) {
          target = { type: "auth", name: o.auth };
        } else if (o.tag) {
          target = { type: "tag", name: o.tag };
        } else if (name) {
          target = { type: "casa", name };
        } else {
          deps.formatter.error("Specify a CASA name or use --global, --auth <name>, --tag <name>");
          process.exitCode = 1;
          return;
        }

        const dir = meterDir(deps.mechaDir);
        const config = readBudgets(dir);
        const removed = removeBudget(config, target, field);
        if (removed) {
          writeBudgets(dir, config);
          deps.formatter.success(`Removed ${field} budget for ${target.type === "global" ? "global" : target.name}`);
        } else {
          deps.formatter.warn(`No ${field} budget found for ${target.type === "global" ? "global" : target.name}`);
        }
      }),
    );

  budget
    .command("ls")
    .description("List all budgets")
    .action(() =>
      withErrorHandler(deps, async () => {
        const dir = meterDir(deps.mechaDir);
        const config = readBudgets(dir);

        if (deps.formatter.isJson) {
          deps.formatter.json(config);
          return;
        }

        let found = false;

        if (config.global && (config.global.dailyUsd !== undefined || config.global.monthlyUsd !== undefined)) {
          found = true;
          const parts = [];
          if (config.global.dailyUsd !== undefined) parts.push(`daily: $${config.global.dailyUsd.toFixed(2)}`);
          if (config.global.monthlyUsd !== undefined) parts.push(`monthly: $${config.global.monthlyUsd.toFixed(2)}`);
          deps.formatter.info(`global: ${parts.join(", ")}`);
        }

        for (const [label, map] of [
          ["casa", config.byCasa],
          ["auth", config.byAuthProfile],
          ["tag", config.byTag],
        ] as const) {
          /* v8 ignore start -- readBudgets always initializes maps */
          if (!map) continue;
          /* v8 ignore stop */
          for (const [name, limit] of Object.entries(map)) {
            /* v8 ignore start -- Object.entries won't yield undefined */
            if (!limit) continue;
            /* v8 ignore stop */
            found = true;
            const parts = [];
            if (limit.dailyUsd !== undefined) parts.push(`daily: $${limit.dailyUsd.toFixed(2)}`);
            if (limit.monthlyUsd !== undefined) parts.push(`monthly: $${limit.monthlyUsd.toFixed(2)}`);
            deps.formatter.info(`${label}:${name}: ${parts.join(", ")}`);
          }
        }

        if (!found) {
          deps.formatter.info("No budgets configured");
        }
      }),
    );
}
