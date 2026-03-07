export interface BotConfigValidationInput {
  permissionMode?: string;
  sandboxMode?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  allowedTools?: string[];
  tools?: string[];
  maxBudgetUsd?: number;
  meterOff?: boolean;
}

export interface BotConfigValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateBotConfig(
  input: BotConfigValidationInput,
): BotConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Rule 1: bypassPermissions requires sandboxMode "require"
  if (
    input.permissionMode === "bypassPermissions" &&
    input.sandboxMode !== "require"
  ) {
    errors.push(
      "permissionMode 'bypassPermissions' requires sandboxMode 'require'",
    );
  }

  // Rule 2: auto + off warning
  if (
    input.permissionMode === "auto" &&
    input.sandboxMode === "off"
  ) {
    warnings.push(
      "permissionMode 'auto' with sandboxMode 'off' has no safety net",
    );
  }

  // Rule 3: systemPrompt and appendSystemPrompt are mutually exclusive
  if (input.systemPrompt !== undefined && input.appendSystemPrompt !== undefined) {
    errors.push("systemPrompt and appendSystemPrompt are mutually exclusive");
  }

  // Rule 4: allowedTools and tools are mutually exclusive (both non-empty)
  if (
    input.allowedTools &&
    input.allowedTools.length > 0 &&
    input.tools &&
    input.tools.length > 0
  ) {
    errors.push("allowedTools and tools are mutually exclusive");
  }

  // Rule 5: maxBudgetUsd with meterOff
  if (input.maxBudgetUsd !== undefined && input.meterOff === true) {
    warnings.push(
      "maxBudgetUsd set but metering is off \u2014 session cap works but no aggregate tracking",
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}
