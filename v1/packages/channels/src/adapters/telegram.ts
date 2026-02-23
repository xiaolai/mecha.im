import { Bot } from "grammy";
import type { ChannelAdapter, MessageHandler, InboundMessage } from "./types.js";

const TELEGRAM_MAX_MESSAGE_LENGTH = 4000;

/** Split text into chunks that fit within Telegram's message limit, preferring newline boundaries. */
export function chunkText(text: string, maxLen: number = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
  if (maxLen <= 0) return [text];
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline within the limit
    const slice = remaining.slice(0, maxLen);
    const lastNewline = slice.lastIndexOf("\n");
    const splitAt = lastNewline > 0 ? lastNewline : maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt === lastNewline ? splitAt + 1 : splitAt);
  }
  return chunks;
}

export interface TelegramAdapterDeps {
  createBot?: (token: string) => Bot;
}

export class TelegramAdapter implements ChannelAdapter {
  readonly channelId: string;
  private readonly bot: Bot;
  private handlersRegistered = false;
  private running = false;

  constructor(channelId: string, botToken: string, deps?: TelegramAdapterDeps) {
    this.channelId = channelId;
    /* v8 ignore start */
    const create = deps?.createBot ?? ((t: string) => new Bot(t));
    /* v8 ignore stop */
    this.bot = create(botToken);
  }

  async start(handler: MessageHandler): Promise<void> {
    if (this.running) return;
    if (!this.handlersRegistered) {
      this.bot.on("message:text", async (ctx) => {
        // Only handle private (DM) messages
        if (ctx.chat.type !== "private") return;
        const msg: InboundMessage = {
          chatId: String(ctx.chat.id),
          text: ctx.message.text,
          messageId: String(ctx.message.message_id),
          from: {
            id: String(ctx.from.id),
            username: ctx.from.username,
          },
        };
        await handler(this.channelId, msg);
      });
      this.handlersRegistered = true;
    }
    // grammy's bot.start() returns a promise that resolves when bot.stop() is called.
    // Fire-and-forget with error catch to prevent unhandled rejections.
    this.bot.start().catch(/* v8 ignore next */ () => {});
    this.running = true;
  }

  async stop(): Promise<void> {
    if (this.running) {
      this.bot.stop();
      this.running = false;
    }
  }

  async sendText(chatId: string, text: string): Promise<void> {
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      await this.bot.api.sendMessage(chatId, chunk);
    }
  }

  async sendTyping(chatId: string): Promise<void> {
    await this.bot.api.sendChatAction(chatId, "typing");
  }
}
