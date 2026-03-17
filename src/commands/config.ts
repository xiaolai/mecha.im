import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { getBot } from "../store.js";
import { requireValidName, printTable } from "../cli-utils.js";
import { atomicWriteText } from "../../shared/atomic-write.js";

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
      let config: Record<string, unknown>;
      try {
        config = parseYaml(raw) as Record<string, unknown>;
      } catch (e) {
        console.error(`Failed to parse config: ${e instanceof Error ? e.message : e}`);
        process.exit(1);
      }

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

        // Validate merged config against schema before writing
        try {
          const { loadBotConfig } = await import("../config.js");
          // Write to temp, validate, then commit
          const merged = stringifyYaml(config);
          const { writeFileSync, unlinkSync } = await import("node:fs");
          const tmpPath = entry.config + ".tmp";
          writeFileSync(tmpPath, merged, { mode: 0o600 });
          try {
            loadBotConfig(tmpPath);
          } catch (validationErr) {
            unlinkSync(tmpPath);
            console.error(`Invalid config after setting ${key}: ${validationErr instanceof Error ? validationErr.message : validationErr}`);
            process.exit(1);
          }
          unlinkSync(tmpPath);
          atomicWriteText(entry.config, merged);
        } catch (writeErr) {
          if ((writeErr as { code?: string }).code === "PROCESS_EXIT") throw writeErr;
          console.error(`Failed to write config: ${writeErr instanceof Error ? writeErr.message : writeErr}`);
          process.exit(1);
        }
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
