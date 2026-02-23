export { ChannelStore } from "./db/store.js";
export type { ChannelRow, ChannelLinkRow } from "./db/store.js";
export { runMigrations } from "./db/migrations.js";
export { TelegramAdapter, chunkText } from "./adapters/telegram.js";
export type { InboundMessage, MessageHandler, ChannelAdapter } from "./adapters/types.js";
export { handleInbound, consumeSSEResponse } from "./gateway/router.js";
export type { GatewayDeps } from "./gateway/router.js";
export { createGatewayServer } from "./gateway/server.js";
export type { GatewayServer, GatewayServerOptions } from "./gateway/server.js";
export {
  openStore,
  channelAdd,
  channelRm,
  channelLs,
  channelLink,
  channelUnlink,
  channelLinks,
} from "./channel-service.js";
