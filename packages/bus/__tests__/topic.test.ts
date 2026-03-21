import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTopic, type Topic } from "../src/topic.js";

describe("Topic", () => {
  let busDir: string;
  let topic: Topic;

  beforeEach(() => {
    busDir = mkdtempSync(join(tmpdir(), "mecha-bus-topic-"));
    topic = createTopic({
      busDir,
      config: { name: "test-topic", retentionDays: 7 },
    });
  });

  describe("publish", () => {
    it("publishes a message and returns its ID", () => {
      const id = topic.publish({ sender: "alice", payload: { event: "test" } });
      expect(id).toBeTruthy();
      expect(topic.messageCount()).toBe(1);
    });

    it("uses provided ID", () => {
      const id = topic.publish({ id: "custom", sender: "alice", payload: "data" });
      expect(id).toBe("custom");
    });

    it("deduplicates by ID", () => {
      topic.publish({ id: "dup", sender: "alice", payload: "first" });
      topic.publish({ id: "dup", sender: "alice", payload: "second" });
      expect(topic.messageCount()).toBe(1);
    });
  });

  describe("subscribe + poll", () => {
    it("subscriber receives messages published after subscribing", () => {
      topic.subscribe({ bot: "bob", concurrency: 1 });

      topic.publish({ id: "msg-1", sender: "alice", payload: "hello" });
      topic.publish({ id: "msg-2", sender: "alice", payload: "world" });

      const msgs = topic.poll("bob");
      expect(msgs).toHaveLength(2);
      expect(msgs[0]!.id).toBe("msg-1");
      expect(msgs[1]!.id).toBe("msg-2");
    });

    it("subscriber does not receive messages published before subscribing", () => {
      topic.publish({ id: "old", sender: "alice", payload: "before" });

      topic.subscribe({ bot: "bob", concurrency: 1 });

      const msgs = topic.poll("bob");
      expect(msgs).toHaveLength(0);
    });

    it("poll advances cursor — no re-reads", () => {
      topic.subscribe({ bot: "bob", concurrency: 1 });
      topic.publish({ id: "msg-1", sender: "alice", payload: "hello" });

      const first = topic.poll("bob");
      expect(first).toHaveLength(1);

      const second = topic.poll("bob");
      expect(second).toHaveLength(0);
    });

    it("respects limit parameter", () => {
      topic.subscribe({ bot: "bob", concurrency: 1 });
      for (let i = 0; i < 5; i++) {
        topic.publish({ sender: "alice", payload: i });
      }

      const batch = topic.poll("bob", 2);
      expect(batch).toHaveLength(2);

      const rest = topic.poll("bob", 10);
      expect(rest).toHaveLength(3);
    });

    it("returns empty for unsubscribed bot", () => {
      topic.publish({ sender: "alice", payload: "test" });
      expect(topic.poll("nobody")).toEqual([]);
    });

    it("multiple subscribers get independent cursors", () => {
      topic.subscribe({ bot: "bob", concurrency: 1 });
      topic.subscribe({ bot: "charlie", concurrency: 1 });

      topic.publish({ id: "shared", sender: "alice", payload: "broadcast" });

      expect(topic.poll("bob")).toHaveLength(1);
      expect(topic.poll("charlie")).toHaveLength(1);

      // Both consumed independently
      expect(topic.poll("bob")).toHaveLength(0);
      expect(topic.poll("charlie")).toHaveLength(0);
    });
  });

  describe("unsubscribe", () => {
    it("removes subscriber", () => {
      topic.subscribe({ bot: "bob", concurrency: 1 });
      expect(topic.unsubscribe("bob")).toBe(true);
      expect(topic.subscribers()).toHaveLength(0);
    });

    it("returns false for unknown subscriber", () => {
      expect(topic.unsubscribe("nobody")).toBe(false);
    });
  });

  describe("subscribers", () => {
    it("lists all subscribers", () => {
      topic.subscribe({ bot: "bob", concurrency: 2, promptTemplate: "handle: {{payload}}" });
      topic.subscribe({ bot: "charlie", concurrency: 1 });

      const subs = topic.subscribers();
      expect(subs).toHaveLength(2);
      expect(subs[0]!.bot).toBe("bob");
      expect(subs[0]!.concurrency).toBe(2);
      expect(subs[1]!.bot).toBe("charlie");
    });

    it("updates existing subscriber config", () => {
      topic.subscribe({ bot: "bob", concurrency: 1 });
      topic.subscribe({ bot: "bob", concurrency: 5 });

      const subs = topic.subscribers();
      expect(subs).toHaveLength(1);
      expect(subs[0]!.concurrency).toBe(5);
    });
  });

  describe("persistence", () => {
    it("messages survive restart", () => {
      topic.publish({ id: "persist", sender: "alice", payload: "durable" });

      const topic2 = createTopic({
        busDir,
        config: { name: "test-topic", retentionDays: 7 },
      });
      expect(topic2.messageCount()).toBe(1);

      // Dedup still works
      topic2.publish({ id: "persist", sender: "alice", payload: "dup" });
      expect(topic2.messageCount()).toBe(1);
    });
  });

  describe("name", () => {
    it("exposes the topic name", () => {
      expect(topic.name).toBe("test-topic");
    });
  });

  describe("security", () => {
    it("rejects topic names with path traversal", () => {
      expect(() => createTopic({
        busDir,
        config: { name: "../escape", retentionDays: 7 },
      })).toThrow("Invalid topic name");
    });

    it("rejects empty topic name", () => {
      expect(() => createTopic({
        busDir,
        config: { name: "", retentionDays: 7 },
      })).toThrow("Invalid topic name");
    });

    it("rejects topic name that is a single dot", () => {
      expect(() => createTopic({
        busDir,
        config: { name: ".", retentionDays: 7 },
      })).toThrow("Invalid topic name");
    });

    it("rejects topic name that is double dot", () => {
      expect(() => createTopic({
        busDir,
        config: { name: "..", retentionDays: 7 },
      })).toThrow("Invalid topic name");
    });

    it("rejects topic name with slashes", () => {
      expect(() => createTopic({
        busDir,
        config: { name: "foo/bar", retentionDays: 7 },
      })).toThrow("Invalid topic name");
    });

    it("rejects topic name with backslash", () => {
      expect(() => createTopic({
        busDir,
        config: { name: "foo\\bar", retentionDays: 7 },
      })).toThrow("Invalid topic name");
    });

    it("rejects topic name containing embedded ..", () => {
      expect(() => createTopic({
        busDir,
        config: { name: "foo..bar", retentionDays: 7 },
      })).toThrow("Invalid topic name");
    });
  });

  describe("edge cases", () => {
    it("readJsonl returns empty array for existing but empty file", () => {
      // Publish a message then read it to create the messages file
      topic.publish({ id: "temp", sender: "alice", payload: "data" });

      // Overwrite messages.jsonl with empty content to trigger the empty-content branch
      const topicDir = join(busDir, "topics", "test-topic");
      writeFileSync(join(topicDir, "messages.jsonl"), "", "utf-8");

      const topic2 = createTopic({
        busDir,
        config: { name: "test-topic", retentionDays: 7 },
      });
      expect(topic2.messageCount()).toBe(0);
    });
  });
});
