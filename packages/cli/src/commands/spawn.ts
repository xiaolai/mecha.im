import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { casaName, validateTags, validateCapabilities, parsePort } from "@mecha/core";
import type { SandboxMode } from "@mecha/core";

const SANDBOX_MODES: readonly string[] = ["auto", "off", "require"];

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
    .option("--sandbox <mode>", "Sandbox mode: auto, off, require", "auto")
    .action(async (name: string, path: string, opts: { port?: string; auth?: string; tags?: string; expose?: string; sandbox?: string }) => {
      const validated = casaName(name);
      const port = opts.port ? parsePort(opts.port) : undefined;
      if (opts.port && port === undefined) {
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
      const sandboxMode = opts.sandbox as SandboxMode | undefined;
      if (sandboxMode && !SANDBOX_MODES.includes(sandboxMode)) {
        deps.formatter.error("Sandbox mode must be one of: auto, off, require");
        process.exitCode = 1;
        return;
      }
      // Subscribe to warning events before spawn (scoped to this CASA)
      /* v8 ignore start -- event handler callback; wiring tested via onEvent call check */
      const unsub = deps.processManager.onEvent((event) => {
        if (event.type === "warning" && event.name === validated) deps.formatter.warn(event.message);
      });
      /* v8 ignore stop */
      try {
        const info = await deps.processManager.spawn({
          name: validated,
          workspacePath: path,
          port,
          auth: opts.auth,
          tags,
          expose,
          sandboxMode,
        });
        deps.formatter.success(`Spawned ${info.name} on port ${info.port}`);
      } finally {
        unsub();
      }
    });
}
