import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { getBot } from "../store.js";
import { requireValidName } from "../cli-utils.js";
import { printTable } from "../cli.utils.js";

export function registerConfigCommand(program: Command): void {
  program
    .command("config <name>")
    .description("View or edit bot configuration")
    .option("--json", "Output as JSON")
    .option("--field <field>", "Show a single field")
    .option("--set <key=value>", "Set a config value (requires bot restart)")
    .action(async (name: string, opts) => {
      requireValidName(name);
      const entry = getBot(name);
      if (!entry?.config) {
        console.error(`Bot "${name}" not found. Run "mecha ls" to see available bots.`);
        process.exit(1);
      }

      // Read bot config file
      let raw: string;
      try {
        raw = readFileSync(entry.config, "utf-8");
      } catch {
        console.error(`Cannot read config: ${entry.config}`);
        process.exit(1);
      }

      const { parse: parseYaml, stringify: stringifyYaml } = await import("yaml");
      const config = parseYaml(raw) as Record<string, unknown>;

      // --set: edit mode
      if (opts.set) {
        const eq = (opts.set as string).indexOf("=");
        if (eq === -1) {
          console.error('Invalid format. Use --set key=value (e.g., --set model=opus)');
          process.exit(1);
        }
        const key = (opts.set as string).slice(0, eq);
        const value = (opts.set as string).slice(eq + 1);

        // Parse numeric values
        const parsed = /^\d+$/.test(value) ? parseInt(value, 10)
          : /^\d+\.\d+$/.test(value) ? parseFloat(value)
          : value === "true" ? true
          : value === "false" ? false
          : value;

        config[key] = parsed;
        const { writeFileSync } = await import("node:fs");
        writeFileSync(entry.config, stringifyYaml(config), { mode: 0o600 });
        console.log(`Set ${key}=${JSON.stringify(parsed)} in ${entry.config}`);
        console.log(`Restart the bot for changes to take effect: mecha restart ${name}`);
        return;
      }

      // --field: single field
      if (opts.field) {
        const val = config[opts.field];
        if (val === undefined) {
          console.error(`Field "${opts.field}" not found in config.`);
          process.exit(1);
        }
        console.log(typeof val === "object" ? JSON.stringify(val, null, 2) : String(val));
        return;
      }

      // --json: full JSON
      if (opts.json) {
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      // Default: table view of key fields
      const fields = ["name", "system", "model", "auth", "max_turns", "max_budget_usd", "workspace", "expose"];
      const rows = fields
        .filter(k => config[k] !== undefined)
        .map(k => {
          let val = config[k];
          if (typeof val === "string" && val.length > 60) val = val.slice(0, 57) + "...";
          return [k, String(val)];
        });
      printTable(["FIELD", "VALUE"], rows);
    });
}
