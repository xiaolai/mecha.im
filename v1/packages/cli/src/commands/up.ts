import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { resolve } from "node:path";
import { mechaUp, loadDotEnvFiles } from "@mecha/service";
import { toUserMessage, toExitCode } from "@mecha/contracts";

export function registerUpCommand(parent: Command, deps: CommandDeps): void {
  parent
    .command("up <path>")
    .description("Create and start a Mecha from a project path")
    .option("-p, --port <port>", "Host port to bind")
    .option("--claude-token <token>", "Claude OAuth token for this mecha")
    .option("--anthropic-key <key>", "Anthropic API key")
    .option("--otp <secret>", "TOTP secret for runtime access")
    .option("--permission-mode <mode>", "Agent permission mode: default, plan, full-auto")
    .option("--show-token", "Print the full auth token to stdout")
    .action(async (pathArg: string, cmdOpts: { port?: string; claudeToken?: string; anthropicKey?: string; otp?: string; permissionMode?: string; showToken?: boolean }) => {
      const { processManager, formatter } = deps;
      const projectPath = resolve(pathArg);

      // Resolve config: CLI flag > process.env > .env file > undefined
      const dotEnv = loadDotEnvFiles(projectPath, process.cwd());
      try {
        const result = await mechaUp(processManager, {
          projectPath,
          port: cmdOpts.port ? parseInt(cmdOpts.port, 10) : undefined,
          claudeToken: cmdOpts.claudeToken ?? process.env["CLAUDE_CODE_OAUTH_TOKEN"] ?? dotEnv["CLAUDE_CODE_OAUTH_TOKEN"],
          anthropicApiKey: cmdOpts.anthropicKey ?? process.env["ANTHROPIC_API_KEY"] ?? dotEnv["ANTHROPIC_API_KEY"],
          otp: cmdOpts.otp ?? process.env["MECHA_OTP"] ?? dotEnv["MECHA_OTP"],
          permissionMode: cmdOpts.permissionMode as "default" | "plan" | "full-auto" | undefined,
        });
        formatter.success("Mecha started successfully.");
        formatter.info(`  ID:   ${result.id}`);
        formatter.info(`  Port: ${result.port}`);
        formatter.info(`  Auth: ${cmdOpts.showToken ? result.authToken : result.authToken.slice(0, 8) + "... (use --show-token to reveal)"}`);
        formatter.info(`  Name: ${result.name}`);
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });
}
