import { existsSync, mkdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { botName, validateTags, validateCapabilities, parsePort, PathNotFoundError, PathNotDirectoryError, validateBotConfig } from "@mecha/core";
import type { SandboxMode } from "@mecha/core";
import { withErrorHandler } from "../error-handler.js";

const SANDBOX_MODES: readonly string[] = ["auto", "off", "require"];
const PERMISSION_MODES: readonly string[] = ["default", "plan", "full-auto"];
const EFFORT_LEVELS: readonly string[] = ["low", "medium", "high"];

export function registerBotSpawnCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("spawn")
    .description("Spawn a new bot process")
    .argument("<name>", "bot name")
    .argument("[path]", "Workspace path (defaults to home directory)")
    .option("--home <dir>", "Home directory for the bot")
    .option("-p, --port <number>", "Port to listen on")
    .option("--auth <profile>", "Auth profile to use (see: mecha auth ls)")
    .option("--no-auth", "Spawn without Claude API credentials")
    .option("--tags <tags>", "Comma-separated tags")
    .option("--expose <caps>", "Comma-separated capabilities to expose (query, read_workspace, write_workspace, execute, read_sessions, lifecycle)")
    .option("--sandbox <mode>", "Sandbox mode: auto, off, require", "auto")
    .option("--model <model>", "Model to use")
    .option("--permission-mode <mode>", "Permission mode (default, plan, full-auto)")
    .option("--meter <mode>", "Meter mode: on (default), off")
    .option("--system-prompt <prompt>", "System prompt override")
    .option("--append-system-prompt <prompt>", "Append to default system prompt")
    .option("--effort <level>", "Effort level: low, medium, high")
    .option("--max-budget <dollars>", "Max USD budget per session")
    .option("--allowed-tools <tools>", "Comma-separated allowed tools (Claude Code syntax)")
    .option("--disallowed-tools <tools>", "Comma-separated disallowed tools")
    .option("--tools <tools>", "Override tool set (comma-separated, empty string disables all)")
    .option("--add-dir <dirs>", "Comma-separated additional directories")
    .option("--agent <name>", "Agent preset name")
    .option("--no-session-persistence", "Disable session persistence")
    .option("--mcp-config <paths>", "Comma-separated MCP config file paths")
    .option("--strict-mcp-config", "Only use specified MCP servers")
    .option("--plugin-dir <dirs>", "Comma-separated plugin directories")
    .option("--disable-slash-commands", "Disable all skills")
    .option("--budget-limit <dollars>", "Mecha-level aggregate budget cap")
    .action(async (name: string, path: string | undefined, opts: {
      port?: string; auth?: string | boolean; tags?: string; expose?: string;
      sandbox?: string; model?: string; permissionMode?: string; meter?: string; home?: string;
      systemPrompt?: string; appendSystemPrompt?: string; effort?: string;
      maxBudget?: string; allowedTools?: string; disallowedTools?: string; tools?: string;
      addDir?: string; agent?: string; sessionPersistence?: boolean;
      mcpConfig?: string; strictMcpConfig?: boolean; pluginDir?: string;
      disableSlashCommands?: boolean; budgetLimit?: string;
    }) => withErrorHandler(deps, async () => {
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
      if (opts.effort && !EFFORT_LEVELS.includes(opts.effort)) {
        deps.formatter.error("Effort must be one of: low, medium, high");
        process.exitCode = 1;
        return;
      }
      // Parse comma-separated and numeric values
      const allowedTools = opts.allowedTools?.split(",").map(t => t.trim()).filter(Boolean);
      const disallowedTools = opts.disallowedTools?.split(",").map(t => t.trim()).filter(Boolean);
      const tools = opts.tools?.split(",").map(t => t.trim()).filter(Boolean);
      const addDirs = opts.addDir?.split(",").map(d => d.trim()).filter(Boolean);
      const mcpConfigFiles = opts.mcpConfig?.split(",").map(p => p.trim()).filter(Boolean);
      const pluginDirs = opts.pluginDir?.split(",").map(p => p.trim()).filter(Boolean);
      const maxBudgetUsd = opts.maxBudget ? parseFloat(opts.maxBudget) : undefined;
      const budgetLimit = opts.budgetLimit ? parseFloat(opts.budgetLimit) : undefined;
      // Cross-field validation
      const validation = validateBotConfig({
        permissionMode: opts.permissionMode,
        sandboxMode,
        systemPrompt: opts.systemPrompt,
        appendSystemPrompt: opts.appendSystemPrompt,
        allowedTools,
        tools,
        maxBudgetUsd,
        meterOff: opts.meter === "off",
      });
      if (!validation.ok) {
        deps.formatter.error(validation.errors.join("; "));
        process.exitCode = 1;
        return;
      }
      for (const w of validation.warnings) {
        deps.formatter.warn(w);
      }
      // Resolve home directory
      const resolvedHome = opts.home ? resolve(opts.home) : undefined;
      if (resolvedHome) {
        if (!existsSync(resolvedHome)) throw new PathNotFoundError(resolvedHome);
        if (!statSync(resolvedHome).isDirectory()) throw new PathNotDirectoryError(resolvedHome);
      }
      // Resolve workspace path — defaults to home, then botDir
      const resolvedPath = path
        ? resolve(path)
        : resolvedHome ?? join(deps.mechaDir, validated);
      // Create default workspace directory if using botDir fallback (no explicit path or home)
      if (!path && !resolvedHome && !existsSync(resolvedPath)) {
        mkdirSync(resolvedPath, { recursive: true });
      }
      if (!existsSync(resolvedPath)) {
        throw new PathNotFoundError(resolvedPath);
      }
      if (!statSync(resolvedPath).isDirectory()) {
        throw new PathNotDirectoryError(resolvedPath);
      }
      // Warn if CWD is not under HOME
      const effectiveHome = resolvedHome ?? join(deps.mechaDir, validated);
      if (!resolvedPath.startsWith(effectiveHome + "/") && resolvedPath !== effectiveHome) {
        deps.formatter.warn(`Workspace ${resolvedPath} is not under home ${effectiveHome}`);
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
          home: resolvedHome,
          systemPrompt: opts.systemPrompt,
          appendSystemPrompt: opts.appendSystemPrompt,
          effort: opts.effort as "low" | "medium" | "high" | undefined,
          maxBudgetUsd,
          allowedTools,
          disallowedTools,
          tools,
          addDirs,
          agent: opts.agent,
          ...(opts.sessionPersistence === false ? { sessionPersistence: false } : {}),
          budgetLimit,
          mcpConfigFiles,
          strictMcpConfig: opts.strictMcpConfig,
          pluginDirs,
          disableSlashCommands: opts.disableSlashCommands,
        });
        deps.formatter.success(`Spawned ${info.name} on port ${info.port}`);
      } finally {
        unsub();
      }
    }));
}
