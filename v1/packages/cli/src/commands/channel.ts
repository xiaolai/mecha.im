import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { toUserMessage, toExitCode, ChannelType } from "@mecha/contracts";
import type { ChannelStore } from "@mecha/channels";

type ChannelModule = typeof import("@mecha/channels");

async function withStore<T>(fn: (store: ChannelStore, mod: ChannelModule) => T): Promise<T> {
  const mod = await import("@mecha/channels");
  const store = mod.openStore();
  try {
    return fn(store, mod);
  } finally {
    store.close();
  }
}

export function registerChannelCommand(parent: Command, deps: CommandDeps): void {
  const channel = parent
    .command("channel")
    .description("Manage channel gateways (Telegram, etc.)");

  channel
    .command("add <type>")
    .description("Register a new channel (e.g. telegram)")
    .option("--bot-token <token>", "Bot token (or set MECHA_BOT_TOKEN env var)")
    .action(async (type: string, opts: { botToken?: string }) => {
      const { formatter } = deps;
      try {
        const parsed = ChannelType.safeParse(type);
        if (!parsed.success) {
          formatter.error(`Invalid channel type: ${type} (supported: ${ChannelType.options.join(", ")})`);
          process.exitCode = 1;
          return;
        }
        const botToken = opts.botToken ?? process.env.MECHA_BOT_TOKEN;
        if (!botToken) {
          formatter.error("Bot token required: use --bot-token <token> or set MECHA_BOT_TOKEN");
          process.exitCode = 1;
          return;
        }
        const row = await withStore((store, mod) => mod.channelAdd(store, parsed.data, botToken));
        formatter.success(`Channel added: ${row.id}`);
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });

  channel
    .command("rm <id>")
    .description("Remove a channel and its links")
    .action(async (id: string) => {
      const { formatter } = deps;
      try {
        await withStore((store, mod) => mod.channelRm(store, id));
        formatter.success(`Channel ${id} removed`);
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });

  channel
    .command("ls")
    .description("List all channels")
    .action(async () => {
      const { formatter } = deps;
      try {
        const rows = await withStore((store, mod) => mod.channelLs(store));
        formatter.table(
          rows.map((r) => ({
            ID: r.id,
            TYPE: r.type,
            ENABLED: r.enabled ? "yes" : "no",
            CREATED: r.created_at,
          })),
          ["ID", "TYPE", "ENABLED", "CREATED"],
        );
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });

  channel
    .command("link <channelId> <chatId> <mechaId>")
    .description("Link a chat to a mecha")
    .action(async (channelId: string, chatId: string, mechaId: string) => {
      const { formatter } = deps;
      try {
        const row = await withStore((store, mod) => mod.channelLink(store, channelId, chatId, mechaId));
        formatter.success(`Linked: ${row.id} (${channelId} / ${chatId} → ${mechaId})`);
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });

  channel
    .command("unlink <channelId> <chatId>")
    .description("Remove a chat-to-mecha link")
    .action(async (channelId: string, chatId: string) => {
      const { formatter } = deps;
      try {
        await withStore((store, mod) => mod.channelUnlink(store, channelId, chatId));
        formatter.success(`Unlinked: ${channelId} / ${chatId}`);
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });

  channel
    .command("links [channelId]")
    .description("List channel links")
    .action(async (channelId?: string) => {
      const { formatter } = deps;
      try {
        const rows = await withStore((store, mod) => mod.channelLinks(store, channelId));
        formatter.table(
          rows.map((r) => ({
            ID: r.id,
            CHANNEL: r.channel_id,
            CHAT: r.chat_id,
            MECHA: r.mecha_id,
            SESSION: r.session_id ?? "-",
          })),
          ["ID", "CHANNEL", "CHAT", "MECHA", "SESSION"],
        );
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });

  channel
    .command("serve")
    .description("Start the channel gateway server")
    .option("-p, --port <port>", "Gateway port", "7650")
    .action(async (opts: { port: string }) => {
      const { formatter } = deps;
      try {
        const port = Number(opts.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          formatter.error(`Invalid port: ${opts.port} (must be integer 1-65535)`);
          process.exitCode = 1;
          return;
        }

        const { createGatewayServer, openStore } = await import("@mecha/channels");
        // Verify store can be opened (validates path)
        const store = openStore();
        store.close();

        const { join } = await import("node:path");
        const { homedir } = await import("node:os");
        const { DEFAULTS } = await import("@mecha/core");
        const dbPath = join(homedir(), DEFAULTS.HOME_DIR, "channels.db");

        const server = await createGatewayServer({ dbPath, port });

        /* v8 ignore start */
        process.on("SIGINT", async () => {
          await server.stop();
          process.exit(0);
        });
        /* v8 ignore stop */

        await server.start();
        formatter.info(`Channel gateway listening on http://127.0.0.1:${port}`);
      } catch (err) {
        formatter.error(toUserMessage(err));
        process.exitCode = toExitCode(err);
      }
    });
}
