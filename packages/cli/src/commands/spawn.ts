import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName, validateTags, validateCapabilities } from "@mecha/core";
export function registerSpawnCommand(program: Command, deps: CommandDeps): void {
  program
    .command("spawn")
    .description("Spawn a new CASA process")
    .argument("<name>", "CASA name")
    .argument("<path>", "Workspace path")
    .option("-p, --port <number>", "Port to listen on")
    .option("--auth <profile>", "Auth profile to use")
    .option("--tags <tags>", "Comma-separated tags")
    .option("--expose <caps>", "Comma-separated capabilities to expose")
    .action(async (name: string, path: string, opts: { port?: string; auth?: string; tags?: string; expose?: string }) => {
      const validated = casaName(name);
      const port = opts.port ? Number(opts.port) : undefined;
      if (opts.port && (!Number.isInteger(port) || port! < 1 || port! > 65535)) {
        deps.formatter.error("Port must be an integer between 1 and 65535");
        process.exitCode = 1;
        return;
      }
      let tags: string[] | undefined;
      if (opts.tags) {
        const result = validateTags(opts.tags.split(",").map(t => t.trim()).filter(Boolean));
        if (!result.ok) {
          deps.formatter.error(result.error);
          process.exitCode = 1;
          return;
        }
        tags = result.tags;
      }
      let expose: string[] | undefined;
      if (opts.expose) {
        const capResult = validateCapabilities(opts.expose.split(",").map(c => c.trim()).filter(Boolean));
        if (!capResult.ok) {
          deps.formatter.error(capResult.error);
          process.exitCode = 1;
          return;
        }
        expose = capResult.capabilities;
      }
      const info = await deps.processManager.spawn({
        name: validated,
        workspacePath: path,
        port,
        auth: opts.auth,
        tags,
        expose,
      });
      deps.formatter.success(`Spawned ${info.name} on port ${info.port}`);
    });
}
