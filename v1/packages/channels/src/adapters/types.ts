/** Normalized inbound message from any channel platform. */
export interface InboundMessage {
  chatId: string;
  text: string;
  messageId: string;
  from: { id: string; username?: string };
}

/** Callback invoked when a message arrives on a channel. */
export type MessageHandler = (channelId: string, msg: InboundMessage) => Promise<void>;

/** Platform-specific adapter that bridges a messaging platform to the gateway. */
export interface ChannelAdapter {
  readonly channelId: string;
  start(handler: MessageHandler): Promise<void>;
  stop(): Promise<void>;
  sendText(chatId: string, text: string): Promise<void>;
  sendTyping(chatId: string): Promise<void>;
}
