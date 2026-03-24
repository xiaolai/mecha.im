import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";

let mechaDir: string;

afterEach(() => {
  process.exitCode = undefined as unknown as number;
  if (mechaDir) {
    rmSync(mechaDir, { recursive: true, force: true });
    mechaDir = undefined as unknown as string;
  }
});

function setup() {
  mechaDir = mkdtempSync(join(tmpdir(), "mecha-bus-"));
  const deps = makeDeps({ mechaDir });
  const program = createProgram(deps);
  program.exitOverride();
  return { deps, program };
}

// ── Topic commands ─────────────────────────────────────────────────────

describe("bus topic create", () => {
  it("creates a topic", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "bus", "topic", "create", "events"]);
    expect(deps.formatter.success).toHaveBeenCalledWith('Topic "events" created');
  });

  it("is idempotent for existing topic", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "bus", "topic", "create", "events"]);
    // Create a second program instance to re-parse against the same mechaDir
    const program2 = createProgram(deps);
    program2.exitOverride();
    await program2.parseAsync(["node", "mecha", "bus", "topic", "create", "events"]);
    expect(deps.formatter.success).toHaveBeenCalledTimes(2);
  });
});

describe("bus topic list", () => {
  it("shows message when no topics", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "bus", "topic", "list"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No topics found");
  });

  it("lists existing topics", async () => {
    const { deps, program } = setup();
    // Create a topic first
    await program.parseAsync(["node", "mecha", "bus", "topic", "create", "alerts"]);

    const program2 = createProgram(deps);
    program2.exitOverride();
    await program2.parseAsync(["node", "mecha", "bus", "topic", "list"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(["Name"], [["alerts"]]);
  });
});

describe("bus topic publish", () => {
  it("publishes a string message", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "bus", "topic", "publish", "events", "hello world"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining('Published message'),
    );
    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining('topic "events"'),
    );
  });

  it("publishes a JSON message", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "bus", "topic", "publish", "events", '{"key":"value"}']);
    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining('Published message'),
    );
  });
});

describe("bus topic tail", () => {
  it("shows info when no messages", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "bus", "topic", "create", "empty"]);

    const program2 = createProgram(deps);
    program2.exitOverride();
    await program2.parseAsync(["node", "mecha", "bus", "topic", "tail", "empty"]);
    expect(deps.formatter.info).toHaveBeenCalledWith('No messages in topic "empty"');
  });

  it("shows info when topic does not exist", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "bus", "topic", "tail", "nonexistent"]);
    expect(deps.formatter.info).toHaveBeenCalledWith('No messages in topic "nonexistent"');
  });

  it("shows last N messages", async () => {
    const { deps, program } = setup();
    // Publish messages
    await program.parseAsync(["node", "mecha", "bus", "topic", "publish", "logs", "msg1"]);
    const p2 = createProgram(deps);
    p2.exitOverride();
    await p2.parseAsync(["node", "mecha", "bus", "topic", "publish", "logs", "msg2"]);
    const p3 = createProgram(deps);
    p3.exitOverride();
    await p3.parseAsync(["node", "mecha", "bus", "topic", "publish", "logs", "msg3"]);

    const p4 = createProgram(deps);
    p4.exitOverride();
    await p4.parseAsync(["node", "mecha", "bus", "topic", "tail", "logs", "-n", "2"]);
    expect(deps.formatter.table).toHaveBeenCalled();
    const tableCall = (deps.formatter.table as ReturnType<typeof import("vitest").vi.fn>).mock.calls;
    const lastCall = tableCall[tableCall.length - 1];
    expect(lastCall[0]).toEqual(["ID", "Timestamp", "Sender", "Payload"]);
    // Should show last 2 of 3 messages
    expect(lastCall[1]).toHaveLength(2);
    expect(lastCall[1][0][3]).toBe("msg2");
    expect(lastCall[1][1][3]).toBe("msg3");
  });

  it("rejects invalid lines count", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "bus", "topic", "tail", "events", "-n", "abc"]);
    expect(deps.formatter.error).toHaveBeenCalledWith("Lines must be a positive integer");
    expect(process.exitCode).toBe(1);
  });

  it("handles empty messages file", async () => {
    const { deps, program } = setup();
    // Create topic dir and empty messages file manually
    const topicDir = join(mechaDir, "bus", "topics", "emptyfile");
    mkdirSync(topicDir, { recursive: true });
    writeFileSync(join(topicDir, "messages.jsonl"), "");

    await program.parseAsync(["node", "mecha", "bus", "topic", "tail", "emptyfile"]);
    expect(deps.formatter.info).toHaveBeenCalledWith('No messages in topic "emptyfile"');
  });
});

// ── Queue commands ─────────────────────────────────────────────────────

describe("bus queue create", () => {
  it("creates a queue with default retries", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "bus", "queue", "create", "tasks"]);
    expect(deps.formatter.success).toHaveBeenCalledWith('Queue "tasks" created (maxRetries: 3)');
  });

  it("creates a queue with custom max-retries", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "bus", "queue", "create", "tasks", "--max-retries", "5"]);
    expect(deps.formatter.success).toHaveBeenCalledWith('Queue "tasks" created (maxRetries: 5)');
  });

  it("rejects invalid max-retries", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "bus", "queue", "create", "tasks", "--max-retries", "abc"]);
    expect(deps.formatter.error).toHaveBeenCalledWith("Max retries must be a non-negative integer");
    expect(process.exitCode).toBe(1);
  });
});

describe("bus queue list", () => {
  it("shows message when no queues", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "bus", "queue", "list"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No queues found");
  });

  it("lists existing queues", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "bus", "queue", "create", "jobs"]);

    const program2 = createProgram(deps);
    program2.exitOverride();
    await program2.parseAsync(["node", "mecha", "bus", "queue", "list"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(["Name"], [["jobs"]]);
  });
});

describe("bus queue inspect", () => {
  it("shows queue stats", async () => {
    const { deps, program } = setup();
    // Create a queue first
    await program.parseAsync(["node", "mecha", "bus", "queue", "create", "work"]);

    const program2 = createProgram(deps);
    program2.exitOverride();
    await program2.parseAsync(["node", "mecha", "bus", "queue", "inspect", "work"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Metric", "Count"],
      [
        ["pending", "0"],
        ["inflight", "0"],
        ["dead", "0"],
      ],
    );
  });
});

describe("bus queue drain", () => {
  it("shows info when queue has no pending messages", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "bus", "queue", "create", "empty"]);

    const program2 = createProgram(deps);
    program2.exitOverride();
    await program2.parseAsync(["node", "mecha", "bus", "queue", "drain", "empty"]);
    expect(deps.formatter.info).toHaveBeenCalledWith('Queue "empty" has no pending messages');
  });

  it("drains pending messages to dead letter", async () => {
    const { deps, program } = setup();
    // Create queue and push a message via the broker directly
    const { createBroker } = await import("@mecha/bus");
    const busDir = join(mechaDir, "bus");
    const broker = createBroker(busDir);
    const q = broker.queue("work");
    q.push({ sender: "test", payload: "task1" });
    q.push({ sender: "test", payload: "task2" });

    await program.parseAsync(["node", "mecha", "bus", "queue", "drain", "work"]);
    expect(deps.formatter.success).toHaveBeenCalledWith(
      'Drained 2 message(s) from queue "work" to dead letter',
    );
  });
});

describe("bus queue nack", () => {
  it("nacks a claimed message", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "bus", "queue", "create", "work"]);
    const { createBroker } = await import("@mecha/bus");
    const busDir = join(mechaDir, "bus");
    const broker = createBroker(busDir);
    const q = broker.queue("work");
    const id = q.push({ sender: "cli", payload: "task" });
    q.claim("worker");

    const program2 = createProgram(deps);
    program2.exitOverride();
    await program2.parseAsync(["node", "mecha", "bus", "queue", "nack", "work", id]);
    expect(deps.formatter.success).toHaveBeenCalled();
  });
});

describe("bus queue dead-letters", () => {
  it("lists dead-letter messages", async () => {
    const { deps, program } = setup();
    // Create queue with retryBackoffMs: 0 to allow immediate re-claim in test
    const { createBroker } = await import("@mecha/bus");
    const busDir = join(mechaDir, "bus");
    const broker = createBroker(busDir);
    const q = broker.queue("dlq", { maxRetries: 2, retryBackoffMs: 0 });
    const id = q.push({ sender: "producer", payload: "work" });
    q.claim("worker"); // attempts=1
    q.nack(id); // 1 < 2, back to pending (no backoff)
    q.claim("worker"); // attempts=2
    q.nack(id); // 2 >= 2, dead letter

    const program2 = createProgram(deps);
    program2.exitOverride();
    await program2.parseAsync(["node", "mecha", "bus", "queue", "dead-letters", "dlq"]);
    expect(deps.formatter.table).toHaveBeenCalled();
    const rows = (deps.formatter.table as ReturnType<typeof import("vitest").vi.fn>).mock.calls[0][1];
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("shows empty message when no dead letters", async () => {
    const { deps, program } = setup();
    await program.parseAsync(["node", "mecha", "bus", "queue", "create", "empty-dlq"]);

    const program2 = createProgram(deps);
    program2.exitOverride();
    await program2.parseAsync(["node", "mecha", "bus", "queue", "dead-letters", "empty-dlq"]);
    expect(deps.formatter.info).toHaveBeenCalled();
  });
});
