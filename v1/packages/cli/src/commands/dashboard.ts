import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { DEFAULTS } from "@mecha/core";

const require = createRequire(import.meta.url);

function resolveDashboardRoot(): string {
  try {
    return dirname(require.resolve("@mecha/dashboard/package.json"));
  } catch {
    throw new Error("@mecha/dashboard is not installed. Run 'pnpm install' from the monorepo root.");
  }
}

export function registerDashboardCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("dashboard")
    .description("Launch the Mecha web dashboard")
    .option("-p, --port <port>", "Port to run on", String(DEFAULTS.DASHBOARD_PORT))
    .option("--no-open", "Do not auto-open browser")
    .action(async (opts: { port: string; open: boolean }) => {
      const { formatter } = deps;
      try {
      const port = opts.port;
      const dashboardDir = resolveDashboardRoot();

      // Check if dashboard has been built
      if (!existsSync(resolve(dashboardDir, ".next"))) {
        formatter.info("Dashboard not built. Building now...");
        const buildResult = spawn("npx", ["next", "build"], {
          cwd: dashboardDir,
          stdio: "inherit",
          env: { ...process.env },
        });
        await new Promise<void>((res, rej) => {
          buildResult.on("exit", (code) => {
            if (code === 0) res();
            else rej(new Error(`Build failed with code ${code}`));
          });
          buildResult.on("error", rej);
        });
      }

      formatter.info(`Starting dashboard on http://localhost:${port}`);

      const child = spawn("npx", ["next", "start", "-p", port, "-H", "127.0.0.1"], {
        cwd: dashboardDir,
        stdio: "inherit",
        env: { ...process.env },
      });

      if (opts.open) {
        // Give the server a moment to start
        setTimeout(() => {
          const url = `http://localhost:${port}`;
          let cmd: string;
          let args: string[];
          if (process.platform === "darwin") {
            cmd = "open";
            args = [url];
          } else if (process.platform === "win32") {
            cmd = "cmd";
            args = ["/c", "start", "", url];
          } else {
            cmd = "xdg-open";
            args = [url];
          }
          spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
        }, 2000);
      }

      child.on("error", (err) => {
        formatter.error(`Failed to start dashboard: ${err.message}`);
        process.exitCode = 1;
      });

      child.on("exit", (code) => {
        if (code && code !== 0) {
          process.exitCode = code;
        }
      });

      // Keep alive
      await new Promise(() => {});
      } catch (err) {
        formatter.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}
