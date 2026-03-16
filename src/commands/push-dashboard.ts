import type { Command } from "commander";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { getBot } from "../store.js";

export function registerPushDashboardCommand(program: Command): void {
  program
    .command("push-dashboard <name>")
    .description("Build bot dashboard and push to a running container (no rebuild)")
    .option("--skip-build", "Skip npm build, just copy existing dist/")
    .action(async (name, opts) => {
      const entry = getBot(name);
      if (!entry?.path) {
        console.error(`Bot "${name}" not found. Run "mecha ls" to see available bots.`);
        process.exit(1);
      }

      const dashboardSrc = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "agent", "dashboard");
      const distPath = join(dashboardSrc, "dist");

      if (!opts.skipBuild) {
        console.log("Building bot dashboard...");
        try {
          execFileSync("npm", ["run", "build"], { cwd: dashboardSrc, stdio: "inherit" });
        } catch {
          console.error("Dashboard build failed");
          process.exit(1);
        }
      }

      if (!existsSync(distPath)) {
        console.error(`No dist/ found at ${distPath}. Run without --skip-build first.`);
        process.exit(1);
      }

      // Copy built dist into the bot's state directory (bind-mounted as /state in the container).
      // The dashboard route checks /state/dashboard-dist/ first, so no container restart needed.
      const targetPath = join(entry.path, "dashboard-dist");
      console.log(`Copying dashboard to ${targetPath}...`);
      try {
        execFileSync("rm", ["-rf", targetPath]);
        execFileSync("cp", ["-r", distPath, targetPath]);
      } catch (err) {
        console.error(`Failed to copy: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }

      console.log(`Dashboard updated on "${name}" — refresh the browser to see changes.`);
    });
}
