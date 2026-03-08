import type { BotConfig } from "@mecha/core";

/**
 * Convert a bot's BotConfig into Claude Code CLI arguments.
 * Pure function — no side effects, easy to test independently.
 */
export function buildClaudeArgs(
  config: Partial<BotConfig>,
  sessionId?: string,
): string[] {
  const args: string[] = [];

  // 1. --resume (only for real session IDs, not mecha-internal new-* IDs)
  if (sessionId && !sessionId.startsWith("new-")) {
    args.push("--resume", sessionId);
  }

  // 2. --model
  if (config.model) {
    args.push("--model", config.model);
  }

  // 3. --system-prompt / --append-system-prompt (mutually exclusive)
  if (config.systemPrompt && config.appendSystemPrompt) {
    throw new Error("systemPrompt and appendSystemPrompt are mutually exclusive");
  }
  if (config.systemPrompt) {
    args.push("--system-prompt", config.systemPrompt);
  }
  if (config.appendSystemPrompt) {
    args.push("--append-system-prompt", config.appendSystemPrompt);
  }

  // 5. --effort
  if (config.effort) {
    args.push("--effort", config.effort);
  }

  // 6. --max-budget-usd
  if (config.maxBudgetUsd != null) {
    args.push("--max-budget-usd", String(config.maxBudgetUsd));
  }

  // 7. --permission-mode
  if (config.permissionMode) {
    args.push("--permission-mode", config.permissionMode);
  }

  // 8. --allowed-tools
  if (config.allowedTools && config.allowedTools.length > 0) {
    args.push("--allowed-tools", ...config.allowedTools);
  }

  // 9. --disallowed-tools
  if (config.disallowedTools && config.disallowedTools.length > 0) {
    args.push("--disallowed-tools", ...config.disallowedTools);
  }

  // 10. --tools
  if (config.tools && config.tools.length > 0) {
    args.push("--tools", ...config.tools);
  }

  // 11. --add-dir
  if (config.addDirs && config.addDirs.length > 0) {
    args.push("--add-dir", ...config.addDirs);
  }

  // 12. --agent
  if (config.agent) {
    args.push("--agent", config.agent);
  }

  // 13. --agents (JSON-stringified object)
  if (config.agents && Object.keys(config.agents).length > 0) {
    args.push("--agents", JSON.stringify(config.agents));
  }

  // 14. --no-session-persistence (only when explicitly false)
  if (config.sessionPersistence === false) {
    args.push("--no-session-persistence");
  }

  // 15. --mcp-config (inline mcpServers as JSON + file paths)
  if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
    args.push("--mcp-config", JSON.stringify({ mcpServers: config.mcpServers }));
  }
  if (config.mcpConfigFiles && config.mcpConfigFiles.length > 0) {
    for (const file of config.mcpConfigFiles) {
      args.push("--mcp-config", file);
    }
  }

  // 16. --strict-mcp-config
  if (config.strictMcpConfig) {
    args.push("--strict-mcp-config");
  }

  // 17. --plugin-dir
  if (config.pluginDirs && config.pluginDirs.length > 0) {
    args.push("--plugin-dir", ...config.pluginDirs);
  }

  // 18. --disable-slash-commands
  if (config.disableSlashCommands) {
    args.push("--disable-slash-commands");
  }

  return args;
}
