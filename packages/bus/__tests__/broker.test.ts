import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBroker, type Broker } from "../src/broker.js";

describe("Broker", () => {
  let busDir: string;
  let broker: Broker;

  beforeEach(() => {
    busDir = mkdtempSync(join(tmpdir(), "mecha-broker-"));
    broker = createBroker(busDir);
  });

  describe("queue", () => {
    it("creates a new queue", () => {
      const q = broker.queue("review");
      expect(q.name).toBe("review");
      expect(broker.queueNames()).toEqual(["review"]);
    });

    it("returns existing queue on repeated call", () => {
      const q1 = broker.queue("review");
      const q2 = broker.queue("review");
      expect(q1).toBe(q2);
    });

    it("persists queue config to bus.json", () => {
      broker.queue("review");
      const config = JSON.parse(readFileSync(join(busDir, "bus.json"), "utf-8"));
      expect(config.queues.review).toBeDefined();
      expect(config.queues.review.name).toBe("review");
      expect(config.queues.review.maxRetries).toBe(3);
    });

    it("accepts custom config", () => {
      broker.queue("urgent", { maxRetries: 5, retryBackoffMs: 1000 });
      const config = JSON.parse(readFileSync(join(busDir, "bus.json"), "utf-8"));
      expect(config.queues.urgent.maxRetries).toBe(5);
    });
  });

  describe("topic", () => {
    it("creates a new topic", () => {
      const t = broker.topic("events");
      expect(t.name).toBe("events");
      expect(broker.topicNames()).toEqual(["events"]);
    });

    it("returns existing topic on repeated call", () => {
      const t1 = broker.topic("events");
      const t2 = broker.topic("events");
      expect(t1).toBe(t2);
    });

    it("persists topic config to bus.json", () => {
      broker.topic("events");
      const config = JSON.parse(readFileSync(join(busDir, "bus.json"), "utf-8"));
      expect(config.topics.events).toBeDefined();
      expect(config.topics.events.retentionDays).toBe(7);
    });
  });

  describe("hydration", () => {
    it("hydrates queues and topics from bus.json on restart", () => {
      const b1 = createBroker(busDir);
      const q = b1.queue("work");
      q.push({ sender: "alice", payload: "task" });
      b1.topic("alerts");

      // Restart broker
      const b2 = createBroker(busDir);
      expect(b2.queueNames()).toEqual(["work"]);
      expect(b2.topicNames()).toEqual(["alerts"]);

      // Queue data survives
      const stats = b2.queue("work").stats();
      expect(stats.pending).toBe(1);
    });
  });

  describe("busDir", () => {
    it("exposes the bus directory path", () => {
      expect(broker.busDir).toBe(busDir);
    });
  });

  describe("multiple queues and topics", () => {
    it("manages multiple independently", () => {
      broker.queue("a");
      broker.queue("b");
      broker.topic("x");
      broker.topic("y");

      expect(broker.queueNames().sort()).toEqual(["a", "b"]);
      expect(broker.topicNames().sort()).toEqual(["x", "y"]);
    });
  });
});
