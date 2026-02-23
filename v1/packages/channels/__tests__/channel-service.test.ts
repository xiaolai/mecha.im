import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChannelStore } from "../src/db/store.js";
import {
  openStore,
  channelAdd,
  channelRm,
  channelLs,
  channelLink,
  channelUnlink,
  channelLinks,
} from "../src/channel-service.js";

describe("openStore", () => {
  it("opens a store with explicit path", () => {
    const dir = mkdtempSync(join(tmpdir(), "mecha-ch-"));
    const store = openStore(join(dir, "test.db"));
    expect(store).toBeInstanceOf(ChannelStore);
    store.close();
    rmSync(dir, { recursive: true });
  });
});

describe("channel-service", () => {
  let store: ChannelStore;

  beforeEach(() => {
    store = new ChannelStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("channelAdd creates a channel", () => {
    const row = channelAdd(store, "telegram", "tok123");
    expect(row.id).toMatch(/^ch-/);
    expect(JSON.parse(row.config)).toEqual({ botToken: "tok123" });
  });

  it("channelAdd rejects invalid channel type", () => {
    expect(() => channelAdd(store, "discord", "tok")).toThrow();
  });

  it("channelRm removes a channel", () => {
    const row = channelAdd(store, "telegram", "tok");
    channelRm(store, row.id);
    expect(channelLs(store)).toHaveLength(0);
  });

  it("channelLs lists channels", () => {
    channelAdd(store, "telegram", "a");
    channelAdd(store, "telegram", "b");
    expect(channelLs(store)).toHaveLength(2);
  });

  it("channelLink creates a link", () => {
    const ch = channelAdd(store, "telegram", "tok");
    const link = channelLink(store, ch.id, "chat1", "mx-1");
    expect(link.mecha_id).toBe("mx-1");
  });

  it("channelUnlink removes a link", () => {
    const ch = channelAdd(store, "telegram", "tok");
    channelLink(store, ch.id, "chat1", "mx-1");
    channelUnlink(store, ch.id, "chat1");
    expect(channelLinks(store)).toHaveLength(0);
  });

  it("channelLinks lists all links", () => {
    const ch = channelAdd(store, "telegram", "tok");
    channelLink(store, ch.id, "chat1", "mx-1");
    channelLink(store, ch.id, "chat2", "mx-2");
    expect(channelLinks(store)).toHaveLength(2);
  });

  it("channelLinks filters by channelId", () => {
    const ch1 = channelAdd(store, "telegram", "a");
    const ch2 = channelAdd(store, "telegram", "b");
    channelLink(store, ch1.id, "chat1", "mx-1");
    channelLink(store, ch2.id, "chat2", "mx-2");
    const filtered = channelLinks(store, ch1.id);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].channel_id).toBe(ch1.id);
  });
});
