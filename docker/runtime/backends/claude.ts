import type { BackendCommand } from "../types";

export function buildCommand(prompt: string): BackendCommand {
  const args = ["--print"];

  const model = process.env.CLAUDE_MODEL;
  if (model) args.push("--model", model);

  const systemPrompt = process.env.CLAUDE_SYSTEM_PROMPT;
  if (systemPrompt) args.push("--system-prompt", systemPrompt);

  const allowedTools = process.env.CLAUDE_ALLOWED_TOOLS;
  if (allowedTools) args.push("--allowed-tools", allowedTools);

  const disallowedTools = process.env.CLAUDE_DISALLOWED_TOOLS;
  if (disallowedTools) args.push("--disallowed-tools", disallowedTools);

  const permissionMode = process.env.CLAUDE_PERMISSION_MODE;
  if (permissionMode) args.push("--permission-mode", permissionMode);

  const effort = process.env.CLAUDE_EFFORT;
  if (effort) args.push("--effort", effort);

  const outputFormat = process.env.CLAUDE_OUTPUT_FORMAT;
  if (outputFormat) args.push("--output-format", outputFormat);

  const maxBudget = process.env.CLAUDE_MAX_BUDGET_USD;
  if (maxBudget) args.push("--max-budget-usd", maxBudget);

  args.push(prompt);

  return { command: "claude", args };
}
