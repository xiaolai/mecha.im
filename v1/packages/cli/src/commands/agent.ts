import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { toUserMessage, toExitCode } from "@mecha/contracts";
import { DEFAULTS } from "@mecha/core";

function resolveApiKey(explicit?: string): string {
  if (explicit) return explicit;

  const keyPath = join(homedir(), DEFAULTS.HOME_DIR, "agent-key");
  try {
    const existing = readFileSync(keyPath, "utf-8").trim();
    if (existing) return existing;
  } catch {
    // File doesn't exist, generate new key
  }

  const key = randomBytes(32).toString("hex");
  mkdirSync(join(homedir(), DEFAULTS.HOME_DIR), { recursive: true });
  writeFileSync(keyPath, key + "\n", { mode: 0o600 });
  return key;
}

export function registerAgentCommand(parent: Command, deps: CommandDeps): void {
  const agent = parent
    .command("agent")
    .description("Manage the mecha mesh agent");

  agent
    .command("start")
    .description("Start the mesh agent server")
    .option("-p, --port <port>", "Agent port", "7660")
    .option("--key <apiKey>", "API key for bearer auth")
    .action(async (opts: { port: string; key?: string }) => {
      const { formatter } = deps;
      try {
        const port = Number(opts.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          formatter.error(`Invalid port: ${opts.port}`);
          process.exitCode = 1;
          return;
        }

        const apiKey = resolveApiKey(opts.key);
        const mod = await import("@mecha/agent");
        const server = await mod.createAgentServer({ port, apiKey });

        /* v8 ignore start */
        process.on("SIGINT", async () => {
          await server.stop();
          process.exit(0);
        });
        /* v8 ignore stop */

        await server.start();
        formatter.info(`Mesh agent listening on http://0.0.0.0:${port}`);
        formatter.info(`API key: ${apiKey.slice(0, 8)}...(use --key to set, stored in ~/.mecha/agent-key)`);
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });
}
