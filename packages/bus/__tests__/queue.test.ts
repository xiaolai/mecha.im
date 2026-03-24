import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createQueue, type DurableQueue } from "../src/queue.js";
import type { ClaimedItem } from "../src/types.js";

describe("DurableQueue", () => {
  let busDir: string;
  let queue: DurableQueue;

  beforeEach(() => {
    busDir = mkdtempSync(join(tmpdir(), "mecha-bus-"));
    queue = createQueue({
      busDir,
      config: { name: "test-queue", maxRetries: 3, retryBackoffMs: 0 },
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
        config: { name: "test-queue", maxRetries: 3, retryBackoffMs: 0 },
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

  describe("claim timeout", () => {
    it("auto-returns expired inflight items to pending", () => {
      const q = createQueue({
        busDir,
        config: { name: "timeout-q", maxRetries: 3, retryBackoffMs: 100, claimTimeoutMs: 100 },
      });
      q.push({ id: "work-1", sender: "test", payload: "work" });
      q.claim("worker");

      expect(q.stats().inflight).toBe(1);
      expect(q.stats().pending).toBe(0);

      // Backdate the claimedAt to simulate timeout
      const inflightPath = join(busDir, "queues", "timeout-q", "inflight.jsonl");
      const items: ClaimedItem[] = readFileSync(inflightPath, "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      items[0]!.claimedAt = new Date(Date.now() - 200).toISOString(); // 200ms ago, > 100ms timeout
      writeFileSync(inflightPath, items.map((i) => JSON.stringify(i)).join("\n") + "\n");

      // Next claim should first expire the timed-out item, returning it to pending
      const item = q.claim("worker");
      expect(item).not.toBeNull();
      expect(item!.message.id).toBe("work-1");
      expect(q.stats().inflight).toBe(1); // re-claimed
      expect(q.stats().pending).toBe(0);
    });

    it("moves expired inflight to dead letter when retries exhausted", () => {
      const q = createQueue({
        busDir,
        config: { name: "timeout-dead-q", maxRetries: 1, retryBackoffMs: 0, claimTimeoutMs: 50 },
      });
      q.push({ id: "doomed", sender: "test", payload: "fail" });
      q.claim("worker"); // attempt 1

      // Backdate to expire
      const inflightPath = join(busDir, "queues", "timeout-dead-q", "inflight.jsonl");
      const items: ClaimedItem[] = readFileSync(inflightPath, "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      items[0]!.claimedAt = new Date(Date.now() - 100).toISOString();
      writeFileSync(inflightPath, items.map((i) => JSON.stringify(i)).join("\n") + "\n");

      // Next claim triggers timeout scan — attempt 1 >= maxRetries 1 → dead letter
      const claimed = q.claim("worker");
      expect(claimed).toBeNull(); // nothing left to claim
      expect(q.stats().dead).toBe(1);
      expect(q.stats().inflight).toBe(0);
    });
  });

  describe("retry backoff", () => {
    it("respects backoff delay on nacked messages", () => {
      const q = createQueue({
        busDir,
        config: { name: "backoff-q", maxRetries: 3, retryBackoffMs: 60_000 },
      });
      q.push({ id: "work-1", sender: "test", payload: "work" });
      q.claim("worker");
      q.nack("work-1");

      // Message should be in pending but not yet claimable (notBefore is in the future)
      expect(q.stats().pending).toBe(1);
      const claimed = q.claim("worker");
      expect(claimed).toBeNull(); // can't claim yet, backoff hasn't elapsed
    });

    it("allows claiming after backoff elapses", () => {
      const q = createQueue({
        busDir,
        config: { name: "backoff-elapsed-q", maxRetries: 3, retryBackoffMs: 100 },
      });
      q.push({ id: "work-1", sender: "test", payload: "work" });
      q.claim("worker");
      q.nack("work-1");

      // Manually backdate the notBefore in the pending file
      const pendingPath = join(busDir, "queues", "backoff-elapsed-q", "pending.jsonl");
      const items = readFileSync(pendingPath, "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      items[0].notBefore = new Date(Date.now() - 1000).toISOString(); // already past
      writeFileSync(pendingPath, items.map((i: unknown) => JSON.stringify(i)).join("\n") + "\n");

      const claimed = q.claim("worker");
      expect(claimed).not.toBeNull();
      expect(claimed!.message.id).toBe("work-1");
      expect(claimed!.attempts).toBe(2); // second attempt
    });

    it("uses exponential backoff on repeated nacks", () => {
      const q = createQueue({
        busDir,
        config: { name: "exp-backoff-q", maxRetries: 5, retryBackoffMs: 1000 },
      });
      q.push({ id: "work-1", sender: "test", payload: "work" });

      // First claim+nack: backoff = 1000 * 2^0 = 1000ms
      q.claim("worker");
      q.nack("work-1");

      const pendingPath = join(busDir, "queues", "exp-backoff-q", "pending.jsonl");
      let items = readFileSync(pendingPath, "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      const notBefore1 = new Date(items[0].notBefore).getTime();
      expect(notBefore1).toBeGreaterThan(Date.now() + 500); // at least ~1s in future

      // Backdate to allow second claim
      items[0].notBefore = new Date(Date.now() - 1).toISOString();
      writeFileSync(pendingPath, items.map((i: unknown) => JSON.stringify(i)).join("\n") + "\n");

      // Second claim+nack: backoff = 1000 * 2^1 = 2000ms
      q.claim("worker");
      q.nack("work-1");

      items = readFileSync(pendingPath, "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      const notBefore2 = new Date(items[0].notBefore).getTime();
      expect(notBefore2).toBeGreaterThan(Date.now() + 1500); // at least ~2s in future
    });

    it("does not set notBefore when retryBackoffMs is 0", () => {
      const q = createQueue({
        busDir,
        config: { name: "no-backoff-q", maxRetries: 3, retryBackoffMs: 0 },
      });
      q.push({ id: "work-1", sender: "test", payload: "work" });
      q.claim("worker");
      q.nack("work-1");

      // With 0ms backoff, message should be immediately claimable
      const claimed = q.claim("worker");
      expect(claimed).not.toBeNull();
      expect(claimed!.message.id).toBe("work-1");
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
        config: { name: "test-queue", maxRetries: 3, retryBackoffMs: 0 },
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
        config: { name: "test-queue", maxRetries: 3, retryBackoffMs: 0 },
      });
      expect(queue2.stats().inflight).toBe(1);

      // Dedup still works for the inflight message ID
      queue2.push({ id: "inflight-persist", sender: "alice", payload: "dup" });
      expect(queue2.stats().pending).toBe(0);
    });
  });

  describe("corrupt data handling", () => {
    it("skips corrupt lines in JSONL on startup", () => {
      // Write a pending file with one valid and one corrupt line
      const qDir = join(busDir, "queues", "corrupt-q");
      mkdirSync(qDir, { recursive: true });
      const validMsg = JSON.stringify({ id: "good", ts: new Date().toISOString(), sender: "alice", payload: "ok" });
      writeFileSync(join(qDir, "pending.jsonl"), `${validMsg}\n{CORRUPT LINE\n`);

      const q = createQueue({
        busDir,
        config: { name: "corrupt-q", maxRetries: 3, retryBackoffMs: 0 },
      });
      expect(q.stats().pending).toBe(1); // only the valid line survived
    });
  });
});
