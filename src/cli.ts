#!/usr/bin/env node

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason instanceof Error ? reason.message : String(reason));
  process.exit(1);
});

import { Command } from "commander";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { doctorMecha, doctorBot } from "./doctor.js";
import { requireValidName, collectAttachments, formatUptime, readCostsToday, printTable, setupHeadscale, fetchRemoteBots, readPromptSSE } from "./cli-utils.js";
import { pc, statusColor, botName, success, withSpinner, hint as hintFmt } from "./cli-output.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerPushDashboardCommand } from "./commands/push-dashboard.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerSessionsCommand } from "./commands/sessions.js";
import { registerCostsCommand } from "./commands/costs.js";
import { registerScheduleCommand } from "./commands/schedule.js";
import { registerWebhooksCommand } from "./commands/webhooks.js";
import { registerCompletionCommand } from "./commands/completion.js";
import { registerDaemonCommand } from "./commands/daemon.js";
import { registerAdapterCommand } from "./commands/adapter.js";

const program = new Command();

program
  .name("mecha")
  .description("An army of agents")
  .version("0.3.10");

// --- init ---
program
  .command("init")
  .description("Initialize mecha and build the Docker image")
  .option("--headscale", "Start a Headscale container for mesh networking")
  .action(async (opts) => {
    console.log(pc.bold("\nWelcome to Mecha\n"));

    // Check prerequisites
    console.log("Checking prerequisites...");
    const { execFileSync } = await import("node:child_process");
    const check = (label: string, cmd: string, args: string[]): boolean => {
      try { execFileSync(cmd, args, { encoding: "utf-8", timeout: 5000 }); console.log(success(label)); return true; }
      catch { console.log(pc.red("✗") + " " + label + pc.dim(" (not found)")); return false; }
    };
    const hasDocker = check("Docker", "docker", ["info"]);
    check("Node.js " + process.version, "node", ["--version"]);
    const hasKey = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN);
    if (hasKey) console.log(success("API key configured"));
    else console.log(pc.yellow("!") + " No API key set " + pc.dim("(set ANTHROPIC_API_KEY or run: mecha auth add <name> <key>)"));

    if (!hasDocker) {
      console.error(pc.red("\nDocker is required. Install it and try again."));
      process.exit(1);
    }

    ensureMechaDir();

    // Copy default office layout if missing
    const mechaDir = (await import("./store.js")).getMechaDir();
    const layoutDest = join(mechaDir, "office-layout.json");
    if (!existsSync(layoutDest)) {
      const defaultLayout = join(dirname(fileURLToPath(import.meta.url)), "..", "agent", "dashboard", "dist", "pixel-engine", "default-layout.json");
      if (existsSync(defaultLayout)) {
        const { copyFileSync } = await import("node:fs");
        copyFileSync(defaultLayout, layoutDest);
      }
    }

    console.log(success("Created ~/.mecha/"));

    if (opts.headscale) {
      await setupHeadscale(readSettings());
    }

    await withSpinner("Building Docker image", () => docker.ensureImage());
    console.log(success("mecha initialized"));

    console.log(pc.dim("\nNext steps:"));
    console.log(pc.dim("  mecha spawn reviewer.yaml        # spawn from config"));
    console.log(pc.dim('  mecha spawn --name X --system "..."  # spawn inline'));
    console.log(pc.dim("  mecha dashboard                  # open fleet dashboard\n"));
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

    const containerId = await withSpinner(`Spawning ${botName(config.name)} (${pc.dim(config.model)})`, () =>
      docker.spawn(config, botPath),
    );
    console.log(success(`Bot ${botName(config.name)} is running (container: ${pc.dim(containerId.slice(0, 12))})`));
    console.log(pc.dim(`  Next: mecha query ${config.name} "hello"`));
    console.log(pc.dim(`        mecha logs ${config.name} -f`));
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
    await withSpinner(`Starting ${botName(name)}`, () => docker.start(name));
    entry = getBot(name) ?? entry;
    console.log(success(`Bot ${botName(name)} is running (container: ${pc.dim(entry.containerId?.slice(0, 12) ?? "unknown")})`));
  });

// --- stop ---
program
  .command("stop [name]")
  .description("Stop a running bot (use --all to stop all)")
  .option("--all", "Stop all running bots")
  .action(async (name: string | undefined, opts) => {
    if (opts.all) {
      const bots = await docker.list();
      const running = bots.filter(b => b.status === "running");
      if (running.length === 0) { console.log("No running bots."); return; }
      console.log(`Stopping ${running.length} bot(s)...`);
      let failures = 0;
      for (const b of running) {
        try { await docker.stop(b.name); console.log(`  Stopped ${b.name}`); }
        catch (e) { failures++; console.error(`  Failed to stop ${b.name}: ${e instanceof Error ? e.message : e}`); }
      }
      if (failures > 0) process.exit(1);
      return;
    }
    if (!name) { console.error("Usage: mecha stop <name> or mecha stop --all"); process.exit(1); }
    requireValidName(name);
    await withSpinner(`Stopping ${botName(name)}`, () => docker.stop(name));
    console.log(success(`Bot ${botName(name)} stopped`));
  });

// --- restart ---
program
  .command("restart [name]")
  .description("Restart a running bot (use --all to restart all)")
  .option("--force", "Force restart even if bot is busy")
  .option("--all", "Restart all running bots")
  .action(async (name: string | undefined, opts) => {
    if (opts.all) {
      const bots = await docker.list();
      const running = bots.filter(b => b.status === "running");
      if (running.length === 0) { console.log("No running bots."); return; }
      console.log(`Restarting ${running.length} bot(s)...`);
      let failures = 0;
      for (const b of running) {
        try { const cid = await docker.restart(b.name); console.log(`  Restarted ${b.name} (${cid.slice(0, 12)})`); }
        catch (e) { failures++; console.error(`  Failed to restart ${b.name}: ${e instanceof Error ? e.message : e}`); }
      }
      if (failures > 0) process.exit(1);
      return;
    }
    if (!name) { console.error("Usage: mecha restart <name> or mecha restart --all"); process.exit(1); }
    requireValidName(name);
    const containerId = await withSpinner(`Restarting ${botName(name)}`, () => docker.restart(name));
    console.log(success(`Bot ${botName(name)} restarted (container: ${pc.dim(containerId.slice(0, 12))})`));
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
    await withSpinner(`Removing ${botName(name)}`, () => docker.remove(name));
    console.log(success(`Bot ${botName(name)} removed`));
  });

// --- ls ---
program
  .command("ls")
  .description("List bots")
  .option("--json", "Output as JSON")
  .option("-q, --quiet", "Output only bot names")
  .option("--status <status>", "Filter by status (running, exited)")
  .action(async (opts) => {
    const bots = await docker.list();
    const settings = readSettings();
    const remoteBots = (settings.headscale_url && settings.headscale_api_key)
      ? await fetchRemoteBots(bots, settings.headscale_url, settings.headscale_api_key)
      : [];
    let allBots = [...bots, ...remoteBots];

    if (opts.status) {
      allBots = allBots.filter(b => b.status === opts.status);
    }

    if (allBots.length === 0) {
      if (!opts.json && !opts.quiet) console.log('No bots found. Use "mecha spawn" to create one.');
      if (opts.json) console.log("[]");
      return;
    }

    if (opts.quiet) {
      for (const b of allBots) console.log(b.name);
      return;
    }

    if (opts.json) {
      const data = allBots.map(b => {
        const entry = getBot(b.name);
        return {
          name: b.name,
          status: b.status,
          model: b.model,
          containerId: b.containerId,
          ports: b.ports || undefined,
          uptime: formatUptime(b.startedAt),
          cost: readCostsToday(entry?.path),
        };
      });
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const header = ["NAME", "STATUS", "MODEL", "UPTIME", "COST", "PORTS"];
    const rows = allBots.map((b) => {
      const entry = getBot(b.name);
      return [botName(b.name), statusColor(b.status), b.model, formatUptime(b.startedAt), readCostsToday(entry?.path), b.ports || pc.dim("-")];
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

// --- exec ---
program
  .command("exec <name> [command...]")
  .description("Run a command inside a bot's container")
  .option("-i, --interactive", "Attach interactive terminal")
  .action(async (name: string, command: string[], opts) => {
    requireValidName(name);
    const cmd = command.length > 0 ? command : ["bash"];
    const interactive = opts.interactive ?? command.length === 0;
    const exitCode = await docker.runInContainer(name, cmd, interactive);
    process.exit(exitCode);
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

// --- config ---
registerConfigCommand(program);

// --- sessions ---
registerSessionsCommand(program);

// --- costs ---
registerCostsCommand(program);

// --- schedule ---
registerScheduleCommand(program);

// --- webhooks ---
registerWebhooksCommand(program);

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

// --- dashboard (alias for daemon start --foreground) ---
program
  .command("dashboard")
  .description("Start the fleet dashboard (alias for: mecha daemon start)")
  .option("--port <port>", "Dashboard port", "7700")
  .option("--host <host>", "Bind address", "127.0.0.1")
  .action(async (opts) => {
    const port = parsePort(opts.port);
    if (port === undefined) {
      console.error(`Invalid dashboard port: "${opts.port}" (must be 1-65535)`);
      process.exit(1);
    }
    // Open browser
    const url = `http://${opts.host === "0.0.0.0" ? "localhost" : opts.host}:${port}`;
    if (process.platform === "darwin") {
      execFile("open", [url], () => {});
    } else if (process.platform === "linux") {
      execFile("xdg-open", [url], () => {});
    }
    const { startDaemon } = await import("./daemon.js");
    await startDaemon(port, opts.host, true);
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

// --- completion ---
registerCompletionCommand(program);

// --- daemon ---
registerDaemonCommand(program);

// --- adapter ---
registerAdapterCommand(program);

// --- version (enhanced) ---
program
  .command("version")
  .description("Show version information for all installed tools")
  .action(async () => {
    const { execFileSync } = await import("node:child_process");
    const ver = (cmd: string, args: string[]): string => {
      try { return execFileSync(cmd, args, { encoding: "utf-8", timeout: 5000 }).trim().split("\n")[0]; }
      catch { return pc.dim("not installed"); }
    };
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    let version = "unknown";
    try { version = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf-8")).version; } catch {}
    console.log(`${pc.bold("mecha")}         ${version}`);
    console.log(`${pc.bold("node")}          ${process.version}`);
    console.log(`${pc.bold("claude-code")}   ${ver("claude", ["--version"])}`);
    console.log(`${pc.bold("codex")}         ${ver("codex", ["--version"])}`);
    console.log(`${pc.bold("gemini")}        ${ver("gemini", ["--version"])}`);
    console.log(`${pc.bold("docker")}        ${ver("docker", ["--version"])}`);
  });

// --- Error handling ---
async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof MechaError) {
      console.error(pc.red("Error:") + " " + err.message);
      if (err.hint) console.error(hintFmt(err.hint));
      process.exit(err.exitCode);
    }
    throw err;
  }
}

main();
