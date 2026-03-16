#!/usr/bin/env node

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason instanceof Error ? reason.message : String(reason));
  process.exit(1);
});

import { Command } from "commander";
import { resolve, dirname } from "node:path";
import type { BotInfo } from "./docker.types.js";
import { existsSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { MechaError } from "../shared/errors.js";
import { parsePort, isValidName } from "../shared/validation.js";
import { ensureMechaDir, getBot, readSettings } from "./store.js";
import { loadBotConfig, buildInlineConfig } from "./config.js";
import * as docker from "./docker.js";
import { resolveHostBotBaseUrl } from "./resolve-endpoint.js";
import { printTable, setupHeadscale, fetchRemoteBots, readPromptSSE } from "./cli.utils.js";
import { doctorMecha, doctorBot } from "./doctor.js";
import { requireValidName, collectAttachments } from "./cli-utils.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerPushDashboardCommand } from "./commands/push-dashboard.js";

const program = new Command();

program
  .name("mecha")
  .description("An army of agents")
  .version("0.1.0");

// --- init ---
program
  .command("init")
  .description("Initialize mecha and build the Docker image")
  .option("--headscale", "Start a Headscale container for mesh networking")
  .action(async (opts) => {
    ensureMechaDir();
    console.log("Created ~/.mecha/ directory structure");

    if (opts.headscale) {
      await setupHeadscale(readSettings());
    }

    await docker.ensureImage();
    console.log("mecha initialized successfully");
  });

// --- spawn ---
program
  .command("spawn [config]")
  .description("Spawn a new bot from config file or inline flags")
  .option("--name <name>", "Bot name (for inline spawn)")
  .option("--system <prompt>", "System prompt (for inline spawn)")
  .option("--model <model>", "Model to use", "sonnet")
  .option("--dir <path>", "Bot state directory")
  .option("--expose <port>", "Expose on host port")
  .action(async (configPath: string | undefined, opts) => {
    ensureMechaDir();

    let config;
    let botPath: string | undefined = opts.dir;

    if (configPath) {
      const absPath = resolve(configPath);
      if (!existsSync(absPath)) {
        console.error(`Config file not found: ${absPath}`);
        process.exit(1);
      }
      config = loadBotConfig(absPath);
      if (!botPath) {
        botPath = dirname(absPath);
      }
    } else if (opts.name && opts.system) {
      config = buildInlineConfig({
        name: opts.name,
        system: opts.system,
        model: opts.model,
      });
    } else {
      console.error("Provide a config file or --name and --system flags");
      process.exit(1);
    }

    if (opts.expose) {
      const port = parsePort(opts.expose);
      if (port === undefined) {
        console.error(`Invalid port: "${opts.expose}" (must be 1-65535)`);
        process.exit(1);
      }
      config = { ...config, expose: port };
    }

    if (config.workspace) {
      const wsPath = resolve(config.workspace);
      if (!existsSync(wsPath) || !statSync(wsPath).isDirectory()) {
        console.error(`Workspace path is not a directory: ${wsPath}`);
        process.exit(1);
      }
      config = { ...config, workspace: wsPath };
    }

    console.log(`Spawning bot "${config.name}" (model: ${config.model})...`);
    const containerId = await docker.spawn(config, botPath);
    console.log(`Bot "${config.name}" is running (container: ${containerId.slice(0, 12)})`);
  });

// --- start ---
program
  .command("start <name>")
  .description("Start a previously stopped bot")
  .action(async (name: string) => {
    requireValidName(name);
    let entry = getBot(name);
    if (!entry) {
      console.error(`Bot "${name}" not found in registry. Use "mecha spawn" first.`);
      process.exit(1);
    }
    console.log(`Starting bot "${name}"...`);
    await docker.start(name);
    entry = getBot(name) ?? entry;
    console.log(`Bot "${name}" is running (container: ${entry.containerId?.slice(0, 12) ?? "unknown"})`);
  });

// --- stop ---
program
  .command("stop <name>")
  .description("Stop a running bot")
  .action(async (name: string) => {
    requireValidName(name);
    console.log(`Stopping bot "${name}"...`);
    await docker.stop(name);
    console.log(`Bot "${name}" stopped`);
  });

// --- restart ---
program
  .command("restart <name>")
  .description("Restart a running bot")
  .option("--force", "Force restart even if bot is busy")
  .action(async (name: string) => {
    requireValidName(name);
    console.log(`Restarting bot "${name}"...`);
    const containerId = await docker.restart(name);
    console.log(`Bot "${name}" restarted (container: ${containerId.slice(0, 12)})`);
  });

// --- rm ---
program
  .command("rm <name>")
  .description("Remove a bot (stop + delete container)")
  .option("-f, --force", "Force remove even if running")
  .action(async (name: string, opts) => {
    requireValidName(name);
    if (!opts.force) {
      try {
        const bots = await docker.list();
        const bot = bots.find(b => b.name === name);
        if (bot && bot.status === "running") {
          console.error(`Bot "${name}" is running. Use -f/--force to stop and remove.`);
          process.exit(1);
        }
      } catch { /* proceed with remove attempt */ }
    }
    console.log(`Removing bot "${name}"...`);
    await docker.remove(name);
    console.log(`Bot "${name}" removed`);
  });

// --- ls ---
program
  .command("ls")
  .description("List bots")
  .action(async () => {
    const bots = await docker.list();
    const settings = readSettings();
    const remoteBots = (settings.headscale_url && settings.headscale_api_key)
      ? await fetchRemoteBots(bots, settings.headscale_url, settings.headscale_api_key)
      : [];
    const allBots = [...bots, ...remoteBots];

    if (allBots.length === 0) {
      console.log('No bots running. Use "mecha spawn" to create one.');
      return;
    }

    const hasRemote = remoteBots.length > 0;
    const header = hasRemote
      ? ["NAME", "STATUS", "MODEL", "CONTAINER", "NODE", "IP", "PORTS", "PATH"]
      : ["NAME", "STATUS", "MODEL", "CONTAINER", "PORTS", "PATH"];

    const rows = allBots.map((b) => {
      const entry = getBot(b.name);
      const path = entry?.path ?? "";
      const ext = b as BotInfo & { node?: string; ip?: string };
      return hasRemote
        ? [b.name, b.status, b.model, b.containerId, ext.node ?? (b.containerId === "remote" ? "remote" : "local"), ext.ip ?? "", b.ports, path]
        : [b.name, b.status, b.model, b.containerId, b.ports, path];
    });

    printTable(header, rows);
  });

// --- query (one-shot CLI) ---
program
  .command("query <name> <message>")
  .description("Send a one-shot prompt to a bot")
  .option("--model <model>", "Override model (e.g. sonnet, opus, haiku)")
  .option("--system <prompt>", "Override system prompt")
  .option("--max-turns <n>", "Override max turns")
  .option("--resume <session>", "Resume a specific session ID")
  .option("--effort <level>", "Thinking effort: low, medium, high, max")
  .option("--budget <usd>", "Max budget in USD")
  .option("--attach <paths...>", "Attach file/folder contents to the prompt")
  .action(async (name: string, message: string, opts) => {
    requireValidName(name);
    const botEntry = getBot(name);
    const botToken = botEntry?.botToken;
    const resolved = await resolveHostBotBaseUrl(name);
    if (!resolved) { console.error(`Bot "${name}" not found or not reachable`); process.exit(1); }

    let fullMessage = message;
    if (opts.attach?.length) {
      fullMessage = `${collectAttachments(opts.attach)}\n\n${message}`;
    }

    const body: Record<string, unknown> = { message: fullMessage };
    if (opts.model) body.model = opts.model;
    if (opts.system) body.system = opts.system;
    if (opts.maxTurns) {
      const n = parseInt(opts.maxTurns, 10);
      if (!Number.isFinite(n) || n < 1) { console.error(`Invalid max-turns: "${opts.maxTurns}"`); process.exit(1); }
      body.max_turns = n;
    }
    if (opts.resume) body.resume = opts.resume;
    if (opts.effort) {
      if (!["low", "medium", "high", "max"].includes(opts.effort)) {
        console.error(`Invalid effort: "${opts.effort}" (valid: low, medium, high, max)`);
        process.exit(1);
      }
      body.effort = opts.effort;
    }
    if (opts.budget) {
      const b = parseFloat(opts.budget);
      if (!Number.isFinite(b) || b <= 0) { console.error(`Invalid budget: "${opts.budget}"`); process.exit(1); }
      body.max_budget_usd = b;
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (botToken) headers["Authorization"] = `Bearer ${botToken}`;
    const resp = await fetch(`${resolved.baseUrl}/prompt`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });

    if (resp.status === 409) { console.error(`Bot "${name}" is busy processing another request`); process.exit(1); }
    if (!resp.ok) { console.error(`Error from bot: ${resp.status} ${resp.statusText}`); process.exit(1); }

    const reader = resp.body?.getReader();
    if (!reader) { console.error("No response body"); process.exit(1); }
    const ok = await readPromptSSE(reader);
    if (!ok) process.exit(1);
  });

// --- mcp (MCP stdio server -- proxy to all bots) ---
program
  .command("mcp")
  .description("Start MCP stdio server (add to .mcp.json to use bots as tools)")
  .action(async () => {
    const { startMcpServer } = await import("./mcp-proxy.js");
    await startMcpServer();
  });

// --- logs ---
program
  .command("logs <name>")
  .description("Show bot logs")
  .option("-f, --follow", "Follow log output")
  .action(async (name: string, opts) => {
    requireValidName(name);
    await docker.logs(name, opts.follow ?? false);
  });

// --- auth ---
registerAuthCommands(program);

// --- token ---
program
  .command("token")
  .description("Generate a bot token for host-container auth")
  .action(() => {
    const token = "mecha_" + randomBytes(24).toString("hex");
    console.log(token);
  });

// --- doctor ---
program
  .command("doctor [name]")
  .description("Diagnose mecha or a specific bot")
  .action(async (name?: string) => {
    const exitCode = name ? await doctorBot(name) : await doctorMecha();
    if (exitCode > 0) process.exit(exitCode);
  });

// --- dashboard ---
program
  .command("dashboard")
  .description("Start the fleet dashboard")
  .option("--port <port>", "Dashboard port", "7700")
  .action(async (opts) => {
    const port = parsePort(opts.port);
    if (port === undefined) {
      console.error(`Invalid dashboard port: "${opts.port}" (must be 1-65535)`);
      process.exit(1);
    }
    const { startDashboardServer } = await import("./dashboard-server.js");
    startDashboardServer(port);

    // Open browser
    const url = `http://localhost:${port}`;
    if (process.platform === "darwin") {
      execFile("open", [url], () => {});
    } else if (process.platform === "linux") {
      execFile("xdg-open", [url], () => {});
    }
    console.log(`Dashboard: ${url}`);
    console.log("Press Ctrl+C to stop");
  });

// --- push-dashboard ---
registerPushDashboardCommand(program);

// --- ssh-key ---
program
  .command("ssh-key <name>")
  .description("Show the SSH public key for a bot (auto-generates if missing)")
  .action(async (name) => {
    const { getBot } = await import("./store.js");
    const { ensureBotSshKey, validateBotPath } = await import("./docker.utils.js");
    const { readFileSync } = await import("node:fs");
    const { isValidName } = await import("../shared/validation.js");
    if (!isValidName(name)) {
      console.error(`Invalid bot name: "${name}"`);
      process.exit(1);
    }
    const entry = getBot(name);
    if (!entry?.path) {
      console.error(`Bot "${name}" not found. Run "mecha ls" to see available bots.`);
      process.exit(1);
    }
    validateBotPath(entry.path);
    const sshDir = ensureBotSshKey(entry.path, name);
    const pubKey = readFileSync(`${sshDir}/id_ed25519.pub`, "utf-8").trim();
    console.log(`\nSSH public key for "${name}":\n`);
    console.log(pubKey);
    console.log(`\nAdd this key to GitHub: Settings → SSH and GPG keys → New SSH key`);
    console.log(`Key file: ${sshDir}/id_ed25519\n`);
  });

// --- Error handling ---
async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof MechaError) {
      console.error(`Error: ${err.message}`);
      if (err.hint) console.error(`  Hint: ${err.hint}`);
      process.exit(err.exitCode);
    }
    throw err;
  }
}

main();
