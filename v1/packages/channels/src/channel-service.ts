import { join } from "node:path";
import { homedir } from "node:os";
import { DEFAULTS } from "@mecha/core";
import { ChannelType } from "@mecha/contracts";
import { ChannelStore } from "./db/store.js";
import type { ChannelRow, ChannelLinkRow } from "./db/store.js";

/** Open (or create) the channel store at the given path, defaulting to ~/.mecha/channels.db */
export function openStore(dbPath?: string): ChannelStore {
  /* v8 ignore start */
  const path = dbPath ?? join(homedir(), DEFAULTS.HOME_DIR, "channels.db");
  /* v8 ignore stop */
  return new ChannelStore(path);
}

export function channelAdd(store: ChannelStore, type: string, botToken: string): ChannelRow {
  ChannelType.parse(type);
  return store.addChannel(type, { botToken });
}

export function channelRm(store: ChannelStore, id: string): void {
  store.removeChannel(id);
}

export function channelLs(store: ChannelStore): ChannelRow[] {
  return store.listChannels();
}

export function channelLink(store: ChannelStore, channelId: string, chatId: string, mechaId: string): ChannelLinkRow {
  return store.addLink(channelId, chatId, mechaId);
}

export function channelUnlink(store: ChannelStore, channelId: string, chatId: string): void {
  store.removeLink(channelId, chatId);
}

export function channelLinks(store: ChannelStore, channelId?: string): ChannelLinkRow[] {
  return store.listLinks(channelId);
}
