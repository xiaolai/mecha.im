import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { mechaConfigure } from "@mecha/service";
import { toUserMessage, toExitCode } from "@mecha/contracts";

export function registerConfigureCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("configure <id>")
    .description("Update runtime configuration of a Mecha")
    .option("--claude-token <token>", "Claude OAuth token")
    .option("--anthropic-key <key>", "Anthropic API key")
    .option("--otp <secret>", "TOTP secret")
    .option("--permission-mode <mode>", "Permission mode: default, plan, full-auto")
    .action(async (id: string, cmdOpts: { claudeToken?: string; anthropicKey?: string; otp?: string; permissionMode?: string }) => {
      const { processManager, formatter } = deps;
      try {
        await mechaConfigure(processManager, {
          id,
          claudeToken: cmdOpts.claudeToken,
          anthropicApiKey: cmdOpts.anthropicKey,
          otp: cmdOpts.otp,
          permissionMode: cmdOpts.permissionMode as "default" | "plan" | "full-auto" | undefined,
        });
        formatter.success(`Mecha '${id}' reconfigured.`);
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });
}
