import type { Command } from "commander";
import { requireValidName, printTable } from "../cli-utils.js";
import { botApiJson, botApiChecked } from "./bot-api.js";

interface WebhookConfig {
  accept?: string[];
  secret?: string;
}

let _botName = "";

export function registerWebhooksCommand(program: Command): void {
  const webhooks = program
    .command("webhooks <name>")
    .description("Manage bot webhooks")
    .hook("preAction", (thisCmd) => {
      _botName = thisCmd.args[0];
      requireValidName(_botName);
    });

  webhooks
    .command("ls")
    .description("List webhook configuration")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const config = await botApiJson<WebhookConfig>(_botName, "/api/webhooks");
      if (opts.json) { console.log(JSON.stringify(config, null, 2)); return; }
      const events = config.accept ?? [];
      if (events.length === 0) { console.log(`No webhook events configured for "${_botName}".`); return; }
      printTable(["EVENT"], events.map(e => [e]));
    });

  webhooks
    .command("add <event>")
    .description("Add a webhook event filter")
    .action(async (event: string) => {
      await botApiChecked(_botName, "/api/webhooks/accept", { method: "POST", body: { event } });
      console.log(`Webhook event "${event}" added.`);
    });

  webhooks
    .command("rm <event>")
    .description("Remove a webhook event filter")
    .action(async (event: string) => {
      await botApiChecked(_botName, `/api/webhooks/accept/${encodeURIComponent(event)}`, { method: "DELETE" });
      console.log(`Webhook event "${event}" removed.`);
    });
}
