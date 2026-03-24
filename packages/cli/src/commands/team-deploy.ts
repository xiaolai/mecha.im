import { readFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { parseTeamDef, deployTeam } from "@mecha/teams";
import { botName } from "@mecha/core";
import type { Capability } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";
import YAML from "js-yaml";

/** Register the 'team deploy' subcommand. */
export function registerTeamDeployCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("deploy")
    .description("Deploy a team from a definition file (JSON or YAML)")
    .argument("<file>", "Path to team definition file (JSON or YAML)")
    .action(async (file: string) => withErrorHandler(deps, async () => {
      const filePath = resolve(file);
      let raw: unknown;
      try {
        const content = readFileSync(filePath, "utf-8");
        const ext = extname(filePath).toLowerCase();
        raw = ext === ".yaml" || ext === ".yml"
          ? YAML.load(content)
          : JSON.parse(content);
      } catch (err) {
        deps.formatter.error(`Failed to read team definition: ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }

      const definition = parseTeamDef(raw);

      const result = await deployTeam({
        definition,
        mechaDir: deps.mechaDir,
        spawnBot: async (name, opts) => {
          try {
            await deps.processManager.spawn({
              name: botName(name),
              workspacePath: opts.cwd,
              home: opts.home,
              model: opts.model,
              tags: opts.tags,
              expose: opts.expose,
              effort: opts.effort as "low" | "medium" | "high" | undefined,
              maxBudgetUsd: opts.maxBudgetUsd,
              sandboxMode: opts.sandboxMode as "auto" | "off" | "require" | undefined,
              systemPrompt: opts.systemPrompt,
              appendSystemPrompt: opts.appendSystemPrompt,
            });
            return true;
          /* v8 ignore start -- spawn failure in callback */
          } catch {
            return false;
          }
          /* v8 ignore stop */
        },
        grantAcl: (source, target, capabilities) => {
          deps.acl.grant(source, target, capabilities as Capability[]);
        },
      });

      // Persist ACL rules written during deploy
      if (result.aclRules > 0) deps.acl.save();

      deps.formatter.success(
        `Deployed team "${result.team}" with ${result.bots.length} bot(s) and ${result.aclRules} ACL rule(s)`,
      );

      /* v8 ignore start -- optional scaffolding and JSON output branches */
      if (result.scaffolded.length > 0) {
        deps.formatter.info(`Scaffolded ${result.scaffolded.length} file(s)`);
      }

      if (deps.formatter.isJson) {
        deps.formatter.json(result);
      }
      /* v8 ignore stop */
    }));
}
