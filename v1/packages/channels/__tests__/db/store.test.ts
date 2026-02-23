import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ChannelStore } from "../../src/db/store.js";
import { ChannelNotFoundError, ChannelLinkNotFoundError, ChannelLinkExistsError } from "@mecha/contracts";

describe("ChannelStore", () => {
  let store: ChannelStore;

  beforeEach(() => {
    store = new ChannelStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  // --- addChannel ---

  it("addChannel creates a channel and returns it", () => {
    const row = store.addChannel("telegram", { botToken: "tok123" });
    expect(row.id).toMatch(/^ch-/);
    expect(row.type).toBe("telegram");
    expect(JSON.parse(row.config)).toEqual({ botToken: "tok123" });
    expect(row.enabled).toBe(1);
    expect(row.created_at).toBeTruthy();
  });

  // --- getChannel ---

  it("getChannel returns existing channel", () => {
    const created = store.addChannel("telegram", { botToken: "tok" });
    const fetched = store.getChannel(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.type).toBe("telegram");
  });

  it("getChannel throws ChannelNotFoundError for missing id", () => {
    expect(() => store.getChannel("ch-nonexistent")).toThrow(ChannelNotFoundError);
  });

  // --- listChannels ---

  it("listChannels returns all channels ordered by created_at", () => {
    store.addChannel("telegram", { botToken: "a" });
    store.addChannel("telegram", { botToken: "b" });
    const list = store.listChannels();
    expect(list).toHaveLength(2);
  });

  it("listChannels returns empty array when no channels", () => {
    expect(store.listChannels()).toEqual([]);
  });

  // --- removeChannel ---

  it("removeChannel deletes a channel", () => {
    const ch = store.addChannel("telegram", { botToken: "tok" });
    store.removeChannel(ch.id);
    expect(store.listChannels()).toHaveLength(0);
  });

  it("removeChannel throws ChannelNotFoundError for missing id", () => {
    expect(() => store.removeChannel("ch-nonexistent")).toThrow(ChannelNotFoundError);
  });

  it("removeChannel cascades to links", () => {
    const ch = store.addChannel("telegram", { botToken: "tok" });
    store.addLink(ch.id, "chat1", "mecha1");
    store.removeChannel(ch.id);
    expect(store.listLinks()).toHaveLength(0);
  });

  // --- addLink ---

  it("addLink creates a link", () => {
    const ch = store.addChannel("telegram", { botToken: "tok" });
    const link = store.addLink(ch.id, "chat1", "mecha1");
    expect(link.id).toMatch(/^cl-/);
    expect(link.channel_id).toBe(ch.id);
    expect(link.chat_id).toBe("chat1");
    expect(link.mecha_id).toBe("mecha1");
    expect(link.session_id).toBeNull();
  });

  it("addLink throws ChannelNotFoundError for missing channel", () => {
    expect(() => store.addLink("ch-missing", "chat1", "mecha1")).toThrow(ChannelNotFoundError);
  });

  it("addLink throws ChannelLinkExistsError for duplicate", () => {
    const ch = store.addChannel("telegram", { botToken: "tok" });
    store.addLink(ch.id, "chat1", "mecha1");
    expect(() => store.addLink(ch.id, "chat1", "mecha2")).toThrow(ChannelLinkExistsError);
  });

  // --- removeLink ---

  it("removeLink deletes a link", () => {
    const ch = store.addChannel("telegram", { botToken: "tok" });
    store.addLink(ch.id, "chat1", "mecha1");
    store.removeLink(ch.id, "chat1");
    expect(store.listLinks()).toHaveLength(0);
  });

  it("removeLink throws ChannelLinkNotFoundError for missing link", () => {
    const ch = store.addChannel("telegram", { botToken: "tok" });
    expect(() => store.removeLink(ch.id, "chat-missing")).toThrow(ChannelLinkNotFoundError);
  });

  // --- getLink ---

  it("getLink returns existing link", () => {
    const ch = store.addChannel("telegram", { botToken: "tok" });
    store.addLink(ch.id, "chat1", "mecha1");
    const link = store.getLink(ch.id, "chat1");
    expect(link).toBeDefined();
    expect(link!.mecha_id).toBe("mecha1");
  });

  it("getLink returns undefined for missing link", () => {
    const ch = store.addChannel("telegram", { botToken: "tok" });
    expect(store.getLink(ch.id, "chat-missing")).toBeUndefined();
  });

  // --- listLinks ---

  it("listLinks returns all links", () => {
    const ch = store.addChannel("telegram", { botToken: "tok" });
    store.addLink(ch.id, "chat1", "mecha1");
    store.addLink(ch.id, "chat2", "mecha2");
    expect(store.listLinks()).toHaveLength(2);
  });

  it("listLinks filters by channelId", () => {
    const ch1 = store.addChannel("telegram", { botToken: "a" });
    const ch2 = store.addChannel("telegram", { botToken: "b" });
    store.addLink(ch1.id, "chat1", "mecha1");
    store.addLink(ch2.id, "chat2", "mecha2");
    expect(store.listLinks(ch1.id)).toHaveLength(1);
    expect(store.listLinks(ch1.id)[0].channel_id).toBe(ch1.id);
  });

  // --- updateSessionId ---

  it("updateSessionId sets session_id on a link", () => {
    const ch = store.addChannel("telegram", { botToken: "tok" });
    store.addLink(ch.id, "chat1", "mecha1");
    store.updateSessionId(ch.id, "chat1", "sess-123");
    const link = store.getLink(ch.id, "chat1");
    expect(link!.session_id).toBe("sess-123");
  });
});
