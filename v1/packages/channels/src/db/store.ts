import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { ChannelNotFoundError, ChannelLinkNotFoundError, ChannelLinkExistsError } from "@mecha/contracts";
import { runMigrations } from "./migrations.js";

export interface ChannelRow {
  id: string;
  type: string;
  config: string;
  enabled: number;
  created_at: string;
}

export interface ChannelLinkRow {
  id: string;
  channel_id: string;
  chat_id: string;
  mecha_id: string;
  session_id: string | null;
  created_at: string;
}

export class ChannelStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    runMigrations(this.db);
  }

  addChannel(type: string, config: Record<string, unknown>): ChannelRow {
    const id = `ch-${randomUUID().slice(0, 8)}`;
    const configJson = JSON.stringify(config);
    this.db.prepare(
      "INSERT INTO channels (id, type, config) VALUES (?, ?, ?)",
    ).run(id, type, configJson);
    return this.db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as ChannelRow;
  }

  getChannel(id: string): ChannelRow {
    const row = this.db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as ChannelRow | undefined;
    if (!row) throw new ChannelNotFoundError(id);
    return row;
  }

  listChannels(): ChannelRow[] {
    return this.db.prepare("SELECT * FROM channels ORDER BY created_at").all() as ChannelRow[];
  }

  removeChannel(id: string): void {
    const result = this.db.prepare("DELETE FROM channels WHERE id = ?").run(id);
    if (result.changes === 0) throw new ChannelNotFoundError(id);
  }

  addLink(channelId: string, chatId: string, mechaId: string): ChannelLinkRow {
    // Verify channel exists
    this.getChannel(channelId);
    const id = `cl-${randomUUID().slice(0, 8)}`;
    try {
      this.db.prepare(
        "INSERT INTO channel_links (id, channel_id, chat_id, mecha_id) VALUES (?, ?, ?, ?)",
      ).run(id, channelId, chatId, mechaId);
    } catch (err) {
      /* v8 ignore start */
      if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
        /* v8 ignore stop */
        throw new ChannelLinkExistsError(channelId, chatId);
      }
      /* v8 ignore start */
      throw err;
      /* v8 ignore stop */
    }
    return this.db.prepare("SELECT * FROM channel_links WHERE id = ?").get(id) as ChannelLinkRow;
  }

  removeLink(channelId: string, chatId: string): void {
    const result = this.db.prepare(
      "DELETE FROM channel_links WHERE channel_id = ? AND chat_id = ?",
    ).run(channelId, chatId);
    if (result.changes === 0) throw new ChannelLinkNotFoundError(channelId, chatId);
  }

  getLink(channelId: string, chatId: string): ChannelLinkRow | undefined {
    return this.db.prepare(
      "SELECT * FROM channel_links WHERE channel_id = ? AND chat_id = ?",
    ).get(channelId, chatId) as ChannelLinkRow | undefined;
  }

  listLinks(channelId?: string): ChannelLinkRow[] {
    if (channelId) {
      return this.db.prepare(
        "SELECT * FROM channel_links WHERE channel_id = ? ORDER BY created_at",
      ).all(channelId) as ChannelLinkRow[];
    }
    return this.db.prepare("SELECT * FROM channel_links ORDER BY created_at").all() as ChannelLinkRow[];
  }

  updateSessionId(channelId: string, chatId: string, sessionId: string): void {
    this.db.prepare(
      "UPDATE channel_links SET session_id = ? WHERE channel_id = ? AND chat_id = ?",
    ).run(sessionId, channelId, chatId);
  }

  close(): void {
    this.db.close();
  }
}
