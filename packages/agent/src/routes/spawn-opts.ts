import type { BotName } from "@mecha/core";
import type { readBotConfig } from "@mecha/core";

/** Build SpawnOpts from a bot's persisted config (used for start/restart). */
export function spawnOptsFromConfig(name: BotName, config: ReturnType<typeof readBotConfig> & object) {
  return {
    name,
    workspacePath: config.workspace,
    home: config.home,
    port: config.port,
    /* v8 ignore start -- null coalescing fallback for optional auth field */
    auth: config.auth ?? undefined,
    /* v8 ignore stop */
    tags: config.tags,
    expose: config.expose,
    sandboxMode: config.sandboxMode,
    model: config.model,
    permissionMode: config.permissionMode,
    systemPrompt: config.systemPrompt,
    appendSystemPrompt: config.appendSystemPrompt,
    effort: config.effort,
    maxBudgetUsd: config.maxBudgetUsd,
    allowedTools: config.allowedTools,
    disallowedTools: config.disallowedTools,
    tools: config.tools,
    agent: config.agent,
    agents: config.agents,
    sessionPersistence: config.sessionPersistence,
    budgetLimit: config.budgetLimit,
    mcpServers: config.mcpServers,
    mcpConfigFiles: config.mcpConfigFiles,
    strictMcpConfig: config.strictMcpConfig,
    pluginDirs: config.pluginDirs,
    disableSlashCommands: config.disableSlashCommands,
    addDirs: config.addDirs,
    env: config.env,
  };
}
