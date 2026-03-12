#!/usr/bin/env node

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason instanceof Error ? reason.message : String(reason));
  process.exit(1);
});

import { Command } from "commander";
import { resolve, dirname } from "node:path";
import { existsSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { MechaError } from "../shared/errors.js";
import { parsePort, isValidName } from "../shared/validation.js";
import { atomicWriteText } from "../shared/atomic-write.js";
import { ensureMechaDir, getMechaDir, getBot, readSettings } from "./store.js";
import { loadBotConfig, buildInlineConfig } from "./config.js";
import {
  addCredential, listCredentials, getCredential, removeCredential,
  detectCredentialType, credentialTypes,
  type Credential,
} from "./auth.js";
import * as docker from "./docker.js";
import { stringify as stringifyYaml } from "yaml";
import { resolveHostBotBaseUrl } from "./resolve-endpoint.js";

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
      console.log("Starting Headscale container...");
      const Docker = (await import("dockerode")).default;
      const d = new Docker();
      try {
        console.log("Pulling headscale image...");
        await d.pull("headscale/headscale:latest");
      } catch (err) {
        console.warn("Failed to pull headscale image (using cached if available):", err instanceof Error ? err.message : String(err));
      }
      const container = await d.createContainer({
        Image: "headscale/headscale:latest",
        name: "mecha-headscale",
        Cmd: ["serve"],
        ExposedPorts: { "8080/tcp": {} },
        HostConfig: {
          PortBindings: { "8080/tcp": [{ HostPort: "8080" }] },
          RestartPolicy: { Name: "unless-stopped" },
        },
      });
      await container.start();
      const exec = await container.exec({ Cmd: ["headscale", "apikeys", "create"], AttachStdout: true });
      const stream = await exec.start({ hijack: true, stdin: false });
      let apiKey = "";
      stream.on("data", (chunk: Buffer) => { apiKey += chunk.toString(); });
      await new Promise<void>((r) => stream.on("end", r));
      apiKey = apiKey.trim();

      const settingsPath = resolve(process.env.HOME ?? "~", ".mecha", "mecha.json");
      const { atomicWriteJson } = await import("../shared/atomic-write.js");
      const settings = readSettings();
      atomicWriteJson(settingsPath, {
        ...settings,
        headscale_url: "http://localhost:8080",
        headscale_api_key: apiKey,
      });
      console.log(`Headscale running at http://localhost:8080`);
      console.log(`API key saved to ~/.mecha/mecha.json`);
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

    // Try to get remote bots from Headscale
    const settings = readSettings();
    const remoteBots: docker.BotInfo[] = [];
    if (settings.headscale_url && settings.headscale_api_key) {
      try {
        const resp = await fetch(`${settings.headscale_url}/api/v1/machine`, {
          headers: { Authorization: `Bearer ${settings.headscale_api_key}` },
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          const data = await resp.json() as {
            machines: Array<{ name: string; ipAddresses: string[]; online: boolean }>;
          };
          for (const m of data.machines) {
            if (!m.name.startsWith("mecha-")) continue;
            const name = m.name.replace(/^mecha-/, "");
            if (bots.some((b) => b.name === name)) {
              const local = bots.find((b) => b.name === name)!;
              (local as docker.BotInfo & { ip: string; node: string }).ip = m.ipAddresses[0] ?? "";
              (local as docker.BotInfo & { node: string }).node = "local";
              continue;
            }
            remoteBots.push({
              name,
              status: m.online ? "running" : "offline",
              model: "unknown",
              containerId: "remote",
              ports: "",
            });
          }
        }
      } catch {
        // Headscale not available
      }
    }

    const allBots = [...bots, ...remoteBots];

    if (allBots.length === 0) {
      console.log('No bots running. Use "mecha spawn" to create one.');
      return;
    }

    const hasRemote = remoteBots.length > 0;
    const header = hasRemote
      ? ["NAME", "STATUS", "MODEL", "CONTAINER", "NODE", "IP", "PORTS"]
      : ["NAME", "STATUS", "MODEL", "CONTAINER", "PORTS"];

    const rows = allBots.map((b) => {
      const ext = b as docker.BotInfo & { node?: string; ip?: string };
      return hasRemote
        ? [b.name, b.status, b.model, b.containerId, ext.node ?? (b.containerId === "remote" ? "remote" : "local"), ext.ip ?? "", b.ports]
        : [b.name, b.status, b.model, b.containerId, b.ports];
    });

    const widths = header.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => r[i].length)),
    );
    const formatRow = (row: string[]) =>
      row.map((cell, i) => cell.padEnd(widths[i])).join("  ");

    console.log(formatRow(header));
    console.log(widths.map((w) => "─".repeat(w)).join("  "));
    rows.forEach((row) => console.log(formatRow(row)));
  });

// --- chat ---
program
  .command("chat <name> <message>")
  .description("Send a prompt to a bot")
  .action(async (name: string, message: string) => {
    if (!isValidName(name)) { console.error(`Invalid bot name: "${name}"`); process.exit(1); }
    // Look up bot token from registry for authenticated calls
    const botEntry = getBot(name);
    const botToken = botEntry?.botToken;
    const resolved = await resolveHostBotBaseUrl(name);
    const url = resolved ? `${resolved.baseUrl}/prompt` : undefined;

    if (!url) {
      console.error(`Bot "${name}" not found or not reachable`);
      process.exit(1);
    }

    const chatHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (botToken) chatHeaders["Authorization"] = `Bearer ${botToken}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: chatHeaders,
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(5 * 60 * 1000), // 5 minute timeout
    });

    if (resp.status === 409) {
      console.error(`Bot "${name}" is busy processing another request`);
      process.exit(1);
    }

    if (!resp.ok) {
      console.error(`Error from bot: ${resp.status} ${resp.statusText}`);
      process.exit(1);
    }

    const reader = resp.body?.getReader();
    if (!reader) {
      console.error("No response body");
      process.exit(1);
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              process.stdout.write(parsed.content);
            } else if (parsed.summary) {
              process.stdout.write(`\n[tool] ${parsed.summary}\n`);
            } else if (parsed.message && !parsed.task_id) {
              console.error(`\nError: ${parsed.message}`);
            } else if (parsed.cost_usd !== undefined) {
              console.log(`\n\n---\nCost: $${parsed.cost_usd.toFixed(4)} | Duration: ${parsed.duration_ms}ms | Session: ${parsed.session_id}`);
            }
          } catch {
            // non-JSON data
          }
        }
      }
    }
    console.log();
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
    // Table header
    const header = ["Name", "Type", "Env", "Account", "Created"];
    const rows = creds.map((c) => [
      c.name,
      c.type,
      c.env,
      c.account ?? "",
      c.created_at ?? "",
    ]);
    const widths = header.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => r[i].length)),
    );
    const formatRow = (row: string[]) =>
      row.map((cell, i) => cell.padEnd(widths[i])).join("  ");
    console.log(formatRow(header));
    console.log(widths.map((w) => "─".repeat(w)).join("  "));
    rows.forEach((row) => console.log(formatRow(row)));
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
