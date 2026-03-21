import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { withErrorHandler } from "../error-handler.js";

const COMPANY_DIR = "_company";

/** Register the 'company init' subcommand. */
export function registerCompanyInitCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("init")
    .description("Initialize the company config repository")
    .action(async () => withErrorHandler(deps, async () => {
      const companyDir = join(deps.mechaDir, COMPANY_DIR);

      if (existsSync(join(companyDir, ".git"))) {
        deps.formatter.info(`Company repository already initialized at ${companyDir}`);
        return;
      }

      mkdirSync(companyDir, { recursive: true });

      try {
        execFileSync("git", ["init"], { cwd: companyDir, stdio: "pipe" });
      } catch (err) {
        deps.formatter.error(`Failed to initialize git repository: ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }

      deps.formatter.success(`Company repository initialized at ${companyDir}`);
    }));
}
