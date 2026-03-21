import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createQueue, type DurableQueue } from "../src/queue.js";

describe("DurableQueue", () => {
  let busDir: string;
  let queue: DurableQueue;

  beforeEach(() => {
    busDir = mkdtempSync(join(tmpdir(), "mecha-bus-"));
    queue = createQueue({
      busDir,
      config: { name: "test-queue", maxRetries: 3, retryBackoffMs: 100 },
    });
  });

  describe("push", () => {
    it("adds a message and returns its ID", () => {
      const id = queue.push({ sender: "alice", payload: { task: "review" } });
      expect(id).toBeTruthy();
      expect(queue.stats().pending).toBe(1);
    });

    it("uses provided ID when given", () => {
      const id = queue.push({ id: "custom-id", sender: "alice", payload: "test" });
      expect(id).toBe("custom-id");
    });

    it("deduplicates by ID", () => {
      queue.push({ id: "dup-1", sender: "alice", payload: "first" });
      queue.push({ id: "dup-1", sender: "alice", payload: "second" });
      expect(queue.stats().pending).toBe(1);
    });
  });

  describe("claim", () => {
    it("returns null on empty queue", () => {
      expect(queue.claim("bob")).toBeNull();
    });

    it("claims the first pending message", () => {
      queue.push({ id: "msg-1", sender: "alice", payload: "hello" });
      const item = queue.claim("bob");
      expect(item).not.toBeNull();
      expect(item!.message.id).toBe("msg-1");
      expect(item!.claimedBy).toBe("bob");
      expect(item!.attempts).toBe(1);
      expect(queue.stats().pending).toBe(0);
      expect(queue.stats().inflight).toBe(1);
    });

    it("claims messages in FIFO order", () => {
      queue.push({ id: "first", sender: "alice", payload: 1 });
      queue.push({ id: "second", sender: "alice", payload: 2 });
      expect(queue.claim("bob")!.message.id).toBe("first");
      expect(queue.claim("bob")!.message.id).toBe("second");
    });
  });

  describe("ack", () => {
    it("removes acknowledged message from inflight", () => {
      queue.push({ id: "msg-1", sender: "alice", payload: "test" });
      queue.claim("bob");
      expect(queue.ack("msg-1")).toBe(true);
      expect(queue.stats().inflight).toBe(0);
    });

    it("returns false for unknown message ID", () => {
      expect(queue.ack("nonexistent")).toBe(false);
    });
  });

  describe("nack", () => {
    it("returns message to pending on nack within retry limit", () => {
      queue.push({ id: "msg-1", sender: "alice", payload: "test" });
      queue.claim("bob");
      expect(queue.nack("msg-1")).toBe(true);
      expect(queue.stats().pending).toBe(1);
      expect(queue.stats().inflight).toBe(0);
      expect(queue.stats().dead).toBe(0);
    });

    it("moves to dead letter after max retries", () => {
      queue.push({ id: "msg-1", sender: "alice", payload: "test" });

      // Exhaust retries: claim + nack 3 times (maxRetries = 3)
      for (let i = 0; i < 3; i++) {
        queue.claim("bob");
        queue.nack("msg-1");
      }

      expect(queue.stats().dead).toBe(1);
      expect(queue.stats().pending).toBe(0);
    });

    it("returns false for unknown message ID", () => {
      expect(queue.nack("nonexistent")).toBe(false);
    });
  });

  describe("stats", () => {
    it("returns correct counts", () => {
      queue.push({ id: "a", sender: "alice", payload: 1 });
      queue.push({ id: "b", sender: "alice", payload: 2 });
      queue.push({ id: "c", sender: "alice", payload: 3 });
      queue.claim("bob");

      const stats = queue.stats();
      expect(stats.pending).toBe(2);
      expect(stats.inflight).toBe(1);
      expect(stats.dead).toBe(0);
    });
  });

  describe("deadLetters", () => {
    it("returns dead letter messages", () => {
      queue.push({ id: "msg-1", sender: "alice", payload: "doomed" });
      for (let i = 0; i < 3; i++) {
        queue.claim("bob");
        queue.nack("msg-1");
      }

      const dead = queue.deadLetters();
      expect(dead).toHaveLength(1);
      expect(dead[0]!.id).toBe("msg-1");
      expect(dead[0]!.payload).toBe("doomed");
    });
  });

  describe("drain", () => {
    it("moves all pending to dead letter", () => {
      queue.push({ id: "a", sender: "alice", payload: 1 });
      queue.push({ id: "b", sender: "alice", payload: 2 });

      const count = queue.drain();
      expect(count).toBe(2);
      expect(queue.stats().pending).toBe(0);
      expect(queue.stats().dead).toBe(2);
    });

    it("returns 0 for empty queue", () => {
      expect(queue.drain()).toBe(0);
    });
  });

  describe("persistence", () => {
    it("survives restart (re-create from same busDir)", () => {
      queue.push({ id: "survive", sender: "alice", payload: "persistent" });

      // Re-create queue from same directory
      const queue2 = createQueue({
        busDir,
        config: { name: "test-queue", maxRetries: 3, retryBackoffMs: 100 },
      });
      expect(queue2.stats().pending).toBe(1);

      // Dedup still works after restart
      queue2.push({ id: "survive", sender: "alice", payload: "duplicate" });
      expect(queue2.stats().pending).toBe(1);
    });
  });

  describe("name", () => {
    it("exposes the queue name", () => {
      expect(queue.name).toBe("test-queue");
    });
  });

  describe("security", () => {
    it("rejects queue names with path traversal", () => {
      expect(() => createQueue({
        busDir,
        config: { name: "../escape", maxRetries: 3, retryBackoffMs: 100 },
      })).toThrow("Invalid queue name");
    });

    it("rejects queue names with slashes", () => {
      expect(() => createQueue({
        busDir,
        config: { name: "foo/bar", maxRetries: 3, retryBackoffMs: 100 },
      })).toThrow("Invalid queue name");
    });

    it("rejects empty queue name", () => {
      expect(() => createQueue({
        busDir,
        config: { name: "", maxRetries: 3, retryBackoffMs: 100 },
      })).toThrow("Invalid queue name");
    });

    it("rejects queue name that is a single dot", () => {
      expect(() => createQueue({
        busDir,
        config: { name: ".", maxRetries: 3, retryBackoffMs: 100 },
      })).toThrow("Invalid queue name");
    });

    it("rejects queue name that is double dot", () => {
      expect(() => createQueue({
        busDir,
        config: { name: "..", maxRetries: 3, retryBackoffMs: 100 },
      })).toThrow("Invalid queue name");
    });

    it("rejects queue name with backslash", () => {
      expect(() => createQueue({
        busDir,
        config: { name: "foo\\bar", maxRetries: 3, retryBackoffMs: 100 },
      })).toThrow("Invalid queue name");
    });

    it("rejects queue name containing embedded ..", () => {
      expect(() => createQueue({
        busDir,
        config: { name: "foo..bar", maxRetries: 3, retryBackoffMs: 100 },
      })).toThrow("Invalid queue name");
    });
  });

  describe("persistence", () => {
    it("restores dead-letter IDs for dedup on restart", () => {
      queue.push({ id: "dead-persist", sender: "alice", payload: "data" });
      // Exhaust retries to move to dead letter
      for (let i = 0; i < 3; i++) {
        queue.claim("bob");
        queue.nack("dead-persist");
      }
      expect(queue.stats().dead).toBe(1);

      // Re-create queue — dead-letter IDs should be loaded for dedup
      const queue2 = createQueue({
        busDir,
        config: { name: "test-queue", maxRetries: 3, retryBackoffMs: 100 },
      });
      expect(queue2.stats().dead).toBe(1);

      // Dedup still works for dead-letter message ID
      queue2.push({ id: "dead-persist", sender: "alice", payload: "dup" });
      expect(queue2.stats().pending).toBe(0);
    });

    it("restores inflight state and attempt counts on restart", () => {
      queue.push({ id: "inflight-persist", sender: "alice", payload: "data" });
      const item = queue.claim("bob");
      expect(item).not.toBeNull();
      expect(item!.attempts).toBe(1);

      // Re-create queue from same directory — inflight items should be loaded
      const queue2 = createQueue({
        busDir,
        config: { name: "test-queue", maxRetries: 3, retryBackoffMs: 100 },
      });
      expect(queue2.stats().inflight).toBe(1);

      // Dedup still works for the inflight message ID
      queue2.push({ id: "inflight-persist", sender: "alice", payload: "dup" });
      expect(queue2.stats().pending).toBe(0);
    });
  });
});
