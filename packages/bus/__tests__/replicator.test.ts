import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTopic } from "../src/topic.js";
import { createReplicator, type ReplicatorFetchFn } from "../src/replicator.js";

describe("Replicator", () => {
  let busDir: string;
  let mechaDir: string;
  const topicName = "events";

  const fakeNodes = [
    { name: "spark01", host: "10.0.0.1", port: 7700, apiKey: "key1" },
    { name: "spark02", host: "10.0.0.2", port: 7700, apiKey: "key2" },
  ];

  const readNodesFn = () => fakeNodes;

  beforeEach(() => {
    busDir = mkdtempSync(join(tmpdir(), "mecha-bus-repl-"));
    mechaDir = mkdtempSync(join(tmpdir(), "mecha-dir-repl-"));
    // Pre-create the topic with a message
    createTopic({ busDir, config: { name: topicName, retentionDays: 7 } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards new messages to target nodes", async () => {
    // Publish a message to the local topic
    const topic = createTopic({ busDir, config: { name: topicName, retentionDays: 7 } });
    topic.publish({ id: "msg-1", sender: "alice", payload: { text: "hello" } });

    const mockFetch: ReplicatorFetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const replicator = createReplicator(
      { busDir, mechaDir, topicName, targetNodes: ["spark01"] },
      mockFetch,
      readNodesFn,
    );

    const result = await replicator.replicate();

    expect(result.sent).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        node: fakeNodes[0],
        path: `/bus/topics/${topicName}/publish`,
        method: "POST",
      }),
    );
  });

  it("skips messages with origin field (remote messages)", async () => {
    const topic = createTopic({ busDir, config: { name: topicName, retentionDays: 7 } });
    // Message with origin = came from remote, should be skipped
    topic.publish({ id: "remote-1", sender: "bob", payload: { text: "hi", origin: "spark01" } });
    // Local message without origin = should be forwarded
    topic.publish({ id: "local-1", sender: "alice", payload: { text: "hello" } });

    const mockFetch: ReplicatorFetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const replicator = createReplicator(
      { busDir, mechaDir, topicName, targetNodes: ["spark01"] },
      mockFetch,
      readNodesFn,
    );

    const result = await replicator.replicate();

    // Only the local message should be forwarded
    expect(result.sent).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("reports errors when target node is not in registry", async () => {
    const topic = createTopic({ busDir, config: { name: topicName, retentionDays: 7 } });
    topic.publish({ id: "msg-1", sender: "alice", payload: { text: "hello" } });

    const mockFetch: ReplicatorFetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const replicator = createReplicator(
      { busDir, mechaDir, topicName, targetNodes: ["unknown-node"] },
      mockFetch,
      () => [],
    );

    const result = await replicator.replicate();

    expect(result.sent).toBe(0);
    expect(result.errors).toContain('Node "unknown-node" not found in registry');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reports errors on fetch failure", async () => {
    const topic = createTopic({ busDir, config: { name: topicName, retentionDays: 7 } });
    topic.publish({ id: "msg-fail", sender: "alice", payload: { text: "will fail" } });

    const mockFetch: ReplicatorFetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const replicator = createReplicator(
      { busDir, mechaDir, topicName, targetNodes: ["spark01"] },
      mockFetch,
      readNodesFn,
    );

    const result = await replicator.replicate();

    expect(result.sent).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("HTTP 500");
  });

  it("does not re-send messages on subsequent replicate calls (cursor advances)", async () => {
    const topic = createTopic({ busDir, config: { name: topicName, retentionDays: 7 } });
    topic.publish({ id: "msg-1", sender: "alice", payload: { text: "first" } });

    const mockFetch: ReplicatorFetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const replicator = createReplicator(
      { busDir, mechaDir, topicName, targetNodes: ["spark01"] },
      mockFetch,
      readNodesFn,
    );

    // First replicate
    const r1 = await replicator.replicate();
    expect(r1.sent).toBe(1);

    // Second replicate — no new messages
    const r2 = await replicator.replicate();
    expect(r2.sent).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Add a new message, replicate again
    topic.publish({ id: "msg-2", sender: "alice", payload: { text: "second" } });
    const r3 = await replicator.replicate();
    expect(r3.sent).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("startReplication and stopReplication control periodic execution", () => {
    const mockFetch: ReplicatorFetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const replicator = createReplicator(
      { busDir, mechaDir, topicName, targetNodes: ["spark01"] },
      mockFetch,
      readNodesFn,
    );

    expect(replicator.active).toBe(false);

    replicator.startReplication(60_000);
    expect(replicator.active).toBe(true);

    // Starting again is a no-op
    replicator.startReplication(60_000);
    expect(replicator.active).toBe(true);

    replicator.stopReplication();
    expect(replicator.active).toBe(false);

    // Stopping again is safe
    replicator.stopReplication();
    expect(replicator.active).toBe(false);
  });

  it("handles fetch exceptions gracefully", async () => {
    const topic = createTopic({ busDir, config: { name: topicName, retentionDays: 7 } });
    topic.publish({ id: "msg-err", sender: "alice", payload: { text: "error" } });

    const mockFetch: ReplicatorFetchFn = vi.fn().mockRejectedValue(new Error("network timeout"));

    const replicator = createReplicator(
      { busDir, mechaDir, topicName, targetNodes: ["spark01"] },
      mockFetch,
      readNodesFn,
    );

    const result = await replicator.replicate();

    expect(result.sent).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("network timeout");
  });

  it("forwards to multiple target nodes independently", async () => {
    const topic = createTopic({ busDir, config: { name: topicName, retentionDays: 7 } });
    topic.publish({ id: "msg-multi", sender: "alice", payload: { text: "broadcast" } });

    const mockFetch: ReplicatorFetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const replicator = createReplicator(
      { busDir, mechaDir, topicName, targetNodes: ["spark01", "spark02"] },
      mockFetch,
      readNodesFn,
    );

    const result = await replicator.replicate();

    expect(result.sent).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("handles non-object payloads by wrapping them", async () => {
    const topic = createTopic({ busDir, config: { name: topicName, retentionDays: 7 } });
    topic.publish({ id: "msg-str", sender: "alice", payload: "just a string" });

    const mockFetch: ReplicatorFetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const replicator = createReplicator(
      { busDir, mechaDir, topicName, targetNodes: ["spark01"] },
      mockFetch,
      readNodesFn,
    );

    const result = await replicator.replicate();
    expect(result.sent).toBe(1);

    const body = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]![0].body;
    expect(body.payload).toEqual({ data: "just a string", origin: "local" });
  });
});
