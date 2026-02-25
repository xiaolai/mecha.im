import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName } from "@mecha/core";
export function registerSpawnCommand(program: Command, deps: CommandDeps): void {
  program
    .command("spawn")
    .description("Spawn a new CASA process")
    .argument("<name>", "CASA name")
    .argument("<path>", "Workspace path")
    .option("-p, --port <number>", "Port to listen on")
    .option("--auth <profile>", "Auth profile to use")
    .option("--tags <tags>", "Comma-separated tags")
    .action(async (name: string, path: string, opts: { port?: string; auth?: string; tags?: string }) => {
      const validated = casaName(name);
      const port = opts.port ? Number(opts.port) : undefined;
      if (opts.port && (!Number.isInteger(port) || port! < 1 || port! > 65535)) {
        deps.formatter.error("Port must be an integer between 1 and 65535");
        process.exitCode = 1;
        return;
      }
      const tags = opts.tags ? opts.tags.split(",").map(t => t.trim()).filter(Boolean) : undefined;
      const info = await deps.processManager.spawn({
        name: validated,
        workspacePath: path,
        port,
        auth: opts.auth,
        tags,
      });
      deps.formatter.success(`Spawned ${info.name} on port ${info.port}`);
    });
}
