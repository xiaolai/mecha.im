import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleBusTool, type BusToolOpts } from "../../src/mcp/bus-tools.js";

describe("bus_publish", () => {
  let busDir: string;

  beforeEach(() => {
    busDir = mkdtempSync(join(tmpdir(), "bus-tools-test-"));
  });
  afterEach(() => { rmSync(busDir, { recursive: true, force: true }); });

  it("publishes a message to a topic", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_publish", {
      topic: "events",
      message: "hello world",
    });

    expect(result.content[0].text).toContain("Published message");
    expect(result.content[0].text).toContain('topic "events"');
    expect(result.isError).toBeUndefined();
  });

  it("returns error when topic is missing", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_publish", { message: "hello" });

    expect(result.content[0].text).toContain("Missing required: topic");
    expect(result.isError).toBe(true);
  });

  it("returns error when topic is empty", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_publish", { topic: "", message: "hello" });

    expect(result.content[0].text).toContain("Missing required: topic");
    expect(result.isError).toBe(true);
  });

  it("returns error when message is missing", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_publish", { topic: "events" });

    expect(result.content[0].text).toContain("Missing required: message");
    expect(result.isError).toBe(true);
  });

  it("returns error when message is empty", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_publish", { topic: "events", message: "" });

    expect(result.content[0].text).toContain("Missing required: message");
    expect(result.isError).toBe(true);
  });
});

describe("bus_queue_push", () => {
  let busDir: string;

  beforeEach(() => {
    busDir = mkdtempSync(join(tmpdir(), "bus-tools-test-"));
  });
  afterEach(() => { rmSync(busDir, { recursive: true, force: true }); });

  it("pushes a message to a queue", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_queue_push", {
      queue: "tasks",
      message: "do something",
    });

    expect(result.content[0].text).toContain("Pushed message");
    expect(result.content[0].text).toContain('queue "tasks"');
    expect(result.isError).toBeUndefined();
  });

  it("returns error when queue is missing", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_queue_push", { message: "hello" });

    expect(result.content[0].text).toContain("Missing required: queue");
    expect(result.isError).toBe(true);
  });

  it("returns error when queue is empty", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_queue_push", { queue: "", message: "hello" });

    expect(result.content[0].text).toContain("Missing required: queue");
    expect(result.isError).toBe(true);
  });

  it("returns error when message is missing", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_queue_push", { queue: "tasks" });

    expect(result.content[0].text).toContain("Missing required: message");
    expect(result.isError).toBe(true);
  });

  it("returns error when message is empty", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_queue_push", { queue: "tasks", message: "" });

    expect(result.content[0].text).toContain("Missing required: message");
    expect(result.isError).toBe(true);
  });
});

describe("bus_queue_claim", () => {
  let busDir: string;

  beforeEach(() => {
    busDir = mkdtempSync(join(tmpdir(), "bus-tools-test-"));
  });
  afterEach(() => { rmSync(busDir, { recursive: true, force: true }); });

  it("claims an item from a queue", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    // Push first
    await handleBusTool(opts, "bus_queue_push", { queue: "tasks", message: "work item" });
    // Then claim
    const result = await handleBusTool(opts, "bus_queue_claim", { queue: "tasks" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.messageId).toBeDefined();
    expect(parsed.sender).toBe("alice");
    expect(parsed.payload).toBe("work item");
    expect(parsed.attempts).toBe(1);
  });

  it("returns message when queue is empty", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_queue_claim", { queue: "empty-queue" });

    expect(result.content[0].text).toBe("No items available in queue");
    expect(result.isError).toBeUndefined();
  });

  it("returns error when queue name is missing", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_queue_claim", {});

    expect(result.content[0].text).toContain("Missing required: queue");
    expect(result.isError).toBe(true);
  });

  it("returns error when queue name is empty", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_queue_claim", { queue: "" });

    expect(result.content[0].text).toContain("Missing required: queue");
    expect(result.isError).toBe(true);
  });
});

describe("bus_queue_ack", () => {
  let busDir: string;

  beforeEach(() => {
    busDir = mkdtempSync(join(tmpdir(), "bus-tools-test-"));
  });
  afterEach(() => { rmSync(busDir, { recursive: true, force: true }); });

  it("acknowledges a claimed item", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    // Push and claim first
    await handleBusTool(opts, "bus_queue_push", { queue: "tasks", message: "work" });
    const claimResult = await handleBusTool(opts, "bus_queue_claim", { queue: "tasks" });
    const { messageId } = JSON.parse(claimResult.content[0].text);

    const result = await handleBusTool(opts, "bus_queue_ack", {
      queue: "tasks",
      messageId,
    });

    expect(result.content[0].text).toContain("Acknowledged");
    expect(result.content[0].text).toContain(messageId);
    expect(result.isError).toBeUndefined();
  });

  it("returns error when messageId is not inflight", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_queue_ack", {
      queue: "tasks",
      messageId: "nonexistent-id",
    });

    expect(result.content[0].text).toContain("not found in inflight");
    expect(result.isError).toBe(true);
  });

  it("returns error when queue is missing", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_queue_ack", { messageId: "abc" });

    expect(result.content[0].text).toContain("Missing required: queue");
    expect(result.isError).toBe(true);
  });

  it("returns error when queue is empty string", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_queue_ack", { queue: "", messageId: "abc" });

    expect(result.content[0].text).toContain("Missing required: queue");
    expect(result.isError).toBe(true);
  });

  it("returns error when messageId is missing", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_queue_ack", { queue: "tasks" });

    expect(result.content[0].text).toContain("Missing required: messageId");
    expect(result.isError).toBe(true);
  });

  it("returns error when messageId is empty string", async () => {
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_queue_ack", { queue: "tasks", messageId: "" });

    expect(result.content[0].text).toContain("Missing required: messageId");
    expect(result.isError).toBe(true);
  });
});

describe("bus_queue_nack", () => {
  let busDir: string;

  beforeEach(() => {
    busDir = mkdtempSync(join(tmpdir(), "bus-tools-test-"));
  });
  afterEach(() => { rmSync(busDir, { recursive: true, force: true }); });

  it("nacks a claimed message back to pending", async () => {
    const opts: BusToolOpts = { busDir, botName: "worker" };
    // Push and claim first
    await handleBusTool(opts, "bus_queue_push", { queue: "test-q", message: "work" });
    const claimResult = await handleBusTool(opts, "bus_queue_claim", { queue: "test-q" });
    const { messageId } = JSON.parse(claimResult.content[0].text);

    const result = await handleBusTool(opts, "bus_queue_nack", { queue: "test-q", messageId });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Returned");
  });

  it("returns error for unknown messageId", async () => {
    const opts: BusToolOpts = { busDir, botName: "worker" };
    const result = await handleBusTool(opts, "bus_queue_nack", { queue: "test-q", messageId: "nonexistent" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found in inflight");
  });

  it("returns error for missing queue param", async () => {
    const opts: BusToolOpts = { busDir, botName: "worker" };
    const result = await handleBusTool(opts, "bus_queue_nack", { queue: "", messageId: "abc" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Missing required: queue");
  });

  it("returns error for missing messageId param", async () => {
    const opts: BusToolOpts = { busDir, botName: "worker" };
    const result = await handleBusTool(opts, "bus_queue_nack", { queue: "test-q", messageId: "" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Missing required: messageId");
  });
});

describe("unknown bus tool", () => {
  it("returns error for unknown tool name", async () => {
    const busDir = mkdtempSync(join(tmpdir(), "bus-tools-test-"));
    const opts: BusToolOpts = { busDir, botName: "alice" };
    const result = await handleBusTool(opts, "bus_unknown", {});

    expect(result.content[0].text).toContain("Unknown bus tool");
    expect(result.isError).toBe(true);

    rmSync(busDir, { recursive: true, force: true });
  });
});
