import type { Command } from "commander";
import { requireValidName, printTable } from "../cli-utils.js";
import { botApiJson, botApiChecked } from "./bot-api.js";

interface WebhookConfig {
  accept?: string[];
  secret?: string;
}

export function registerWebhooksCommand(program: Command): void {
  const webhooks = program
    .command("webhooks <name>")
    .description("Manage bot webhooks");

  webhooks
    .command("ls")
    .description("List webhook configuration")
    .option("--json", "Output as JSON")
    .action(async (opts, cmd) => {
      const name = cmd.parent.args[0];
      requireValidName(name);
      const config = await botApiJson<WebhookConfig>(name, "/webhooks");

      if (opts.json) {
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      const events = config.accept ?? [];
      if (events.length === 0) {
        console.log(`No webhook events configured for "${name}".`);
        return;
      }
      printTable(["EVENT"], events.map(e => [e]));
    });

  webhooks
    .command("add <event>")
    .description("Add a webhook event filter")
    .action(async (event: string, _opts, cmd) => {
      const name = cmd.parent.parent.args[0];
      requireValidName(name);
      await botApiChecked(name, "/webhooks/accept", {
        method: "POST",
        body: { event },
      });
      console.log(`Webhook event "${event}" added.`);
    });

  webhooks
    .command("rm <event>")
    .description("Remove a webhook event filter")
    .action(async (event: string, _opts, cmd) => {
      const name = cmd.parent.parent.args[0];
      requireValidName(name);
      await botApiChecked(name, `/webhooks/accept/${encodeURIComponent(event)}`, { method: "DELETE" });
      console.log(`Webhook event "${event}" removed.`);
    });
}
