import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import type { CasaName } from "@mecha/core";
import { casaSpawn } from "@mecha/service";

export function registerSpawnCommand(program: Command, deps: CommandDeps): void {
  program
    .command("spawn")
    .description("Spawn a new CASA process")
    .argument("<name>", "CASA name")
    .argument("<path>", "Workspace path")
    .option("-p, --port <number>", "Port to listen on")
    .option("--auth <profile>", "Auth profile to use")
    .action(async (name: string, path: string, opts: { port?: string; auth?: string }) => {
      const info = await casaSpawn(deps.processManager, {
        name: name as CasaName,
        workspacePath: path,
        port: opts.port ? Number(opts.port) : undefined,
        auth: opts.auth,
      });
      deps.formatter.success(`Spawned ${info.name} on port ${info.port}`);
    });
}
