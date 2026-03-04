import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName, validateTags, validateCapabilities, parsePort, PathNotFoundError, PathNotDirectoryError } from "@mecha/core";
import type { SandboxMode } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

const SANDBOX_MODES: readonly string[] = ["auto", "off", "require"];
const PERMISSION_MODES: readonly string[] = ["default", "plan", "full-auto"];

export function registerBotSpawnCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("spawn")
    .description("Spawn a new bot process")
    .argument("<name>", "bot name")
    .argument("<path>", "Workspace path")
    .option("-p, --port <number>", "Port to listen on")
    .option("--auth <profile>", "Auth profile to use (see: mecha auth ls)")
    .option("--no-auth", "Spawn without Claude API credentials")
    .option("--tags <tags>", "Comma-separated tags")
    .option("--expose <caps>", "Comma-separated capabilities to expose (query, read_workspace, write_workspace, execute, read_sessions, lifecycle)")
    .option("--sandbox <mode>", "Sandbox mode: auto, off, require", "auto")
    .option("--model <model>", "Model to use")
    .option("--permission-mode <mode>", "Permission mode (default, plan, full-auto)")
    .option("--meter <mode>", "Meter mode: on (default), off")
    .action(async (name: string, path: string, opts: { port?: string; auth?: string | boolean; tags?: string; expose?: string; sandbox?: string; model?: string; permissionMode?: string; meter?: string }) => withErrorHandler(deps, async () => {
      const validated = botName(name);
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
      if (opts.permissionMode && !PERMISSION_MODES.includes(opts.permissionMode)) {
        deps.formatter.error("Permission mode must be one of: default, plan, full-auto");
        process.exitCode = 1;
        return;
      }
      // Validate workspace path exists and is a directory
      const resolvedPath = resolve(path);
      if (!existsSync(resolvedPath)) {
        throw new PathNotFoundError(resolvedPath);
      }
      if (!statSync(resolvedPath).isDirectory()) {
        throw new PathNotDirectoryError(resolvedPath);
      }
      // Subscribe to warning events before spawn (scoped to this bot)
      /* v8 ignore start -- event handler callback; wiring tested via onEvent call check */
      const unsub = deps.processManager.onEvent((event) => {
        if (event.type === "warning" && event.name === validated) deps.formatter.warn(event.message);
      });
      /* v8 ignore stop */
      try {
        const info = await deps.processManager.spawn({
          name: validated,
          workspacePath: resolvedPath,
          port,
          auth: opts.auth === false ? null : (opts.auth as string | undefined),
          tags,
          expose,
          sandboxMode,
          model: opts.model,
          permissionMode: opts.permissionMode,
          meterOff: opts.meter === "off",
        });
        deps.formatter.success(`Spawned ${info.name} on port ${info.port}`);
      } finally {
        unsub();
      }
    }));
}
