import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { mechaEnv } from "@mecha/service";
import { toUserMessage, toExitCode } from "@mecha/contracts";

const SENSITIVE_KEYS = new Set([
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "MECHA_OTP",
  "MECHA_AUTH_TOKEN",
]);

const SENSITIVE_PATTERN = /(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|CREDENTIAL)/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key) || SENSITIVE_PATTERN.test(key);
}

export function registerEnvCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("env <id>")
    .description("Show container environment variables")
    .option("--show-secrets", "Show sensitive values instead of masking them")
    .action(async (id: string, cmdOpts: { showSecrets?: boolean }) => {
      const { processManager, formatter } = deps;
      const jsonMode = parent.opts().json ?? false;
      const showSecrets = cmdOpts.showSecrets ?? false;
      try {
        const result = await mechaEnv(processManager, id);
        const masked = result.env.map((e) => ({
          key: e.key,
          value: !showSecrets && isSensitiveKey(e.key) ? "***" : e.value,
        }));
        if (jsonMode) {
          formatter.json({ id: result.id, env: masked });
        } else {
          const rows = masked.map((e) => ({ KEY: e.key, VALUE: e.value }));
          formatter.table(rows, ["KEY", "VALUE"]);
        }
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });
}
