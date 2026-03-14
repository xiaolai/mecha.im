import type { Command } from "commander";
import { stringify as stringifyYaml } from "yaml";
import { isValidName } from "../../shared/validation.js";
import { atomicWriteText } from "../../shared/atomic-write.js";
import { ensureMechaDir, getBot } from "../store.js";
import { loadBotConfig } from "../config.js";
import {
  addCredential, listCredentials, getCredential, removeCredential,
  detectCredentialType, credentialTypes,
  type Credential,
} from "../auth.js";
import * as docker from "../docker.js";
import { printTable } from "../cli.utils.js";

export function registerAuthCommands(program: Command): void {
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
}
