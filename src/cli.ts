#!/usr/bin/env node

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason instanceof Error ? reason.message : String(reason));
  process.exit(1);
});

import { Command } from "commander";
import { resolve, dirname, join, basename } from "node:path";
import type { BotInfo } from "./docker.types.js";
import { existsSync, statSync, readFileSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { MechaError } from "../shared/errors.js";
import { parsePort, isValidName } from "../shared/validation.js";
import { atomicWriteText } from "../shared/atomic-write.js";
import { ensureMechaDir, getBot, readSettings } from "./store.js";
import { loadBotConfig, buildInlineConfig } from "./config.js";
import {
  addCredential, listCredentials, getCredential, removeCredential,
  detectCredentialType, credentialTypes,
  type Credential,
} from "./auth.js";
import * as docker from "./docker.js";
import { stringify as stringifyYaml } from "yaml";
import { resolveHostBotBaseUrl } from "./resolve-endpoint.js";
import { printTable, setupHeadscale, fetchRemoteBots, readPromptSSE } from "./cli.utils.js";
import { doctorMecha, doctorBot } from "./doctor.js";

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
    if (!isValidName(name)) { console.error(`Invalid bot name: "${name}"`); process.exit(1); }
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
    if (!isValidName(name)) { console.error(`Invalid bot name: "${name}"`); process.exit(1); }
    console.log(`Stopping bot "${name}"...`);
    await docker.stop(name);
    console.log(`Bot "${name}" stopped`);
  });

// --- rm ---
program
  .command("rm <name>")
  .description("Remove a bot (stop + delete container)")
  .action(async (name: string) => {
    if (!isValidName(name)) { console.error(`Invalid bot name: "${name}"`); process.exit(1); }
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

/** Escape a string for use in an XML attribute */
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Collect file contents from a list of paths (files or directories, recursive) */
function collectAttachments(paths: string[]): string {
  const MAX_BYTES = 512 * 1024; // 512KB total limit
  let totalBytes = 0;
  const parts: string[] = [];

  function addFile(filePath: string, label: string) {
    if (totalBytes >= MAX_BYTES) return;
    const stat = statSync(filePath);
    if (!stat.isFile()) return;
    const raw = readFileSync(filePath);
    const remaining = MAX_BYTES - totalBytes;
    const trimmedBuf = raw.length > remaining ? raw.subarray(0, remaining) : raw;
    const trimmed = trimmedBuf.toString("utf-8");
    totalBytes += trimmedBuf.length;
    parts.push(`<file path="${escapeAttr(label)}">\n${trimmed}\n</file>`);
  }

  function walkDir(dirPath: string, base: string) {
    if (totalBytes >= MAX_BYTES) return;
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      if (totalBytes >= MAX_BYTES) return;
      if (entry.name.startsWith(".")) continue;
      const full = join(dirPath, entry.name);
      const label = join(base, entry.name);
      if (entry.isDirectory()) walkDir(full, label);
      else addFile(full, label);
    }
  }

  for (const p of paths) {
    if (totalBytes >= MAX_BYTES) break;
    const abs = resolve(p);
    if (!existsSync(abs)) {
      console.error(`Attachment not found: ${abs}`);
      process.exit(1);
    }
    if (statSync(abs).isDirectory()) walkDir(abs, basename(abs));
    else addFile(abs, basename(abs));
  }

  if (totalBytes >= MAX_BYTES) {
    console.warn("Warning: attachments truncated at 512KB total");
  }
  return parts.join("\n\n");
}

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
    if (!isValidName(name)) { console.error(`Invalid bot name: "${name}"`); process.exit(1); }
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

// --- mcp (MCP stdio server — proxy to all bots) ---
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
    if (!isValidName(name)) { console.error(`Invalid bot name: "${name}"`); process.exit(1); }
    await docker.logs(name, opts.follow ?? false);
  });

// --- auth ---
const authCmd = program
  .command("auth")
  .description("Manage credentials (credentials.yaml)");

authCmd
  .command("add <name> <key>")
  .description("Add a credential (auto-detects type from key prefix)")
  .option("--type <type>", "Override type: api_key, oauth_token, bot_token, secret, tailscale")
  .option("--env <env>", "Override env var name")
  .option("--account <account>", "Account label (e.g. email)")
  .option("--created-at <date>", "Creation date (YYYY-MM-DD), defaults to today")
  .action((name: string, key: string, opts: { type?: string; env?: string; account?: string; createdAt?: string }) => {
    ensureMechaDir();
    const detected = detectCredentialType(key);
    if (opts.type && !(credentialTypes as readonly string[]).includes(opts.type)) {
      console.error(`Invalid credential type: "${opts.type}" (valid: ${credentialTypes.join(", ")})`);
      process.exit(1);
    }
    const createdAt = opts.createdAt ?? new Date().toISOString().slice(0, 10);
    const cred: Credential = {
      name,
      type: (opts.type as Credential["type"]) ?? detected.type,
      env: opts.env ?? detected.env,
      key,
      created_at: createdAt,
      ...(opts.account ? { account: opts.account } : {}),
    };
    addCredential(cred);
    console.log(`Added credential "${name}" (type: ${cred.type}, env: ${cred.env})`);
  });

authCmd
  .command("list")
  .description("List all credentials")
  .action(() => {
    const creds = listCredentials();
    if (creds.length === 0) {
      console.log("No credentials configured. Run: mecha auth add <name> <key>");
      return;
    }
    const header = ["Name", "Type", "Env", "Account", "Created"];
    const rows = creds.map((c) => [
      c.name,
      c.type,
      c.env,
      c.account ?? "",
      c.created_at ?? "",
    ]);
    printTable(header, rows);
  });

authCmd
  .command("rm <name>")
  .description("Remove a credential")
  .action((name: string) => {
    if (removeCredential(name)) {
      console.log(`Removed credential "${name}"`);
    } else {
      console.error(`Credential "${name}" not found`);
      process.exit(1);
    }
  });

authCmd
  .command("swap <bot> <profile>")
  .description("Swap auth credential for a running bot (restarts the bot)")
  .action(async (botName: string, profileName: string) => {
    if (!isValidName(botName)) { console.error(`Invalid bot name: "${botName}"`); process.exit(1); }
    if (!isValidName(profileName)) { console.error(`Invalid profile name: "${profileName}"`); process.exit(1); }
    getCredential(profileName); // validate exists

    const entry = getBot(botName);
    if (!entry?.config) {
      console.error(`Bot "${botName}" not found or has no saved config`);
      process.exit(1);
    }

    const config = loadBotConfig(entry.config);
    const updatedConfig = { ...config, auth: profileName };
    atomicWriteText(entry.config, stringifyYaml(updatedConfig));

    console.log(`Swapping auth for "${botName}" to profile "${profileName}"...`);
    try {
      await docker.stop(botName);
    } catch (err) {
      console.warn("Stop before swap:", err instanceof Error ? err.message : err);
    }
    try {
      await docker.remove(botName);
    } catch (err) {
      console.warn("Remove before swap:", err instanceof Error ? err.message : err);
    }
    const containerId = await docker.spawn(updatedConfig, entry.path);
    console.log(`Bot "${botName}" restarted with new auth (container: ${containerId.slice(0, 12)})`);
  });

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

// --- Error handling ---
async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof MechaError) {
      console.error(`Error: ${err.message}`);
      process.exit(err.exitCode);
    }
    throw err;
  }
}

main();
