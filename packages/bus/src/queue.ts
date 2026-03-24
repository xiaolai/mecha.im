import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { assertSafeName, createLogger } from "@mecha/core";
import type { BusMessage, ClaimedItem, QueueConfig } from "./types.js";
import { readJsonl, writeJsonl, appendJsonl } from "./jsonl.js";
import { withFileLock } from "./file-lock.js";

const log = createLogger("mecha:bus");

/** Durable queue with push/claim/ack/nack and dead-letter support. */
export interface DurableQueue {
  /** Push a message to the queue. Returns the message ID. Deduplicates by ID. */
  push(msg: Omit<BusMessage, "id" | "ts"> & { id?: string }): string;

  /** Claim the next pending message for processing. Returns null if empty. */
  claim(bot: string): ClaimedItem | null;

  /** Acknowledge successful processing. Removes from inflight. */
  ack(messageId: string): boolean;

  /** Negative-acknowledge. Returns to pending (with retry) or moves to dead letter. */
  nack(messageId: string): boolean;

  /** Get queue stats. */
  stats(): { pending: number; inflight: number; dead: number };

  /** List dead-letter messages. */
  deadLetters(): BusMessage[];

  /** Drain: move all pending to dead letter. */
  drain(): number;

  /** Get the queue name. */
  readonly name: string;
}

/** Options for creating a durable queue. */
export interface CreateQueueOpts {
  busDir: string;
  config: QueueConfig;
}

/**
 * Create a durable queue backed by JSONL files.
 * All writes are serialized (single caller — the daemon process).
 */
export function createQueue(opts: CreateQueueOpts): DurableQueue {
  const { config } = opts;
  assertSafeName(config.name, "queue");
  const queueDir = join(opts.busDir, "queues", config.name);
  mkdirSync(queueDir, { recursive: true });

  const pendingPath = join(queueDir, "pending.jsonl");
  const inflightPath = join(queueDir, "inflight.jsonl");
  const deadPath = join(queueDir, "dead.jsonl");
  const lockPath = join(queueDir, ".lock");

  /** Track seen IDs for idempotency within the queue's lifetime. */
  const seenIds = new Set<string>();
  /** Track attempt counts across claim/nack cycles. */
  const attemptCounts = new Map<string, number>();

  // Load existing IDs and attempt counts on startup
  for (const msg of readJsonl<BusMessage>(pendingPath)) seenIds.add(msg.id);
  for (const item of readJsonl<ClaimedItem>(inflightPath)) {
    seenIds.add(item.message.id);
    attemptCounts.set(item.message.id, item.attempts);
  }
  for (const msg of readJsonl<BusMessage>(deadPath)) seenIds.add(msg.id);

  return {
    name: config.name,

    push(partial) {
      const id = partial.id ?? randomUUID();
      if (seenIds.has(id)) return id; // deduplicate
      seenIds.add(id);

      const msg: BusMessage = {
        id,
        ts: new Date().toISOString(),
        sender: partial.sender,
        payload: partial.payload,
      };
      appendJsonl(pendingPath, msg);
      return id;
    },

    claim(bot) {
      return withFileLock(lockPath, () => {
        // Expire timed-out inflight items before claiming
        const timeoutMs = config.claimTimeoutMs ?? 300_000;
        const inflight = readJsonl<ClaimedItem>(inflightPath);
        const now = Date.now();
        const expired: ClaimedItem[] = [];
        const remaining: ClaimedItem[] = [];
        for (const item of inflight) {
          if (now - new Date(item.claimedAt).getTime() > timeoutMs) {
            expired.push(item);
          } else {
            remaining.push(item);
          }
        }
        if (expired.length > 0) {
          log.warn("Claim timeout: expired items returned", { count: expired.length });
          writeJsonl(inflightPath, remaining);
          for (const item of expired) {
            if (item.attempts >= config.maxRetries) {
              appendJsonl(deadPath, item.message);
            } else {
              appendJsonl(pendingPath, item.message);
            }
          }
        }

        const pending = readJsonl<BusMessage>(pendingPath);
        // Find the first claimable item (skip messages still in backoff)
        const claimableIdx = pending.findIndex(
          (m) => !m.notBefore || now >= new Date(m.notBefore).getTime(),
        );
        if (claimableIdx === -1) return null;

        const msg = pending.splice(claimableIdx, 1)[0]!;
        delete msg.notBefore; // clear backoff marker on claim
        writeJsonl(pendingPath, pending);

        const prevAttempts = attemptCounts.get(msg.id) ?? 0;
        const item: ClaimedItem = {
          message: msg,
          claimedBy: bot,
          claimedAt: new Date().toISOString(),
          attempts: prevAttempts + 1,
        };
        attemptCounts.set(msg.id, item.attempts);
        appendJsonl(inflightPath, item);
        log.info("Message claimed", { id: msg.id, bot, attempt: item.attempts });

        return item;
      });
    },

    ack(messageId) {
      return withFileLock(lockPath, () => {
        const inflight = readJsonl<ClaimedItem>(inflightPath);
        const idx = inflight.findIndex((i) => i.message.id === messageId);
        if (idx === -1) return false;

        inflight.splice(idx, 1);
        writeJsonl(inflightPath, inflight);
        log.info("Message acknowledged", { id: messageId });
        return true;
      });
    },

    nack(messageId) {
      return withFileLock(lockPath, () => {
        const inflight = readJsonl<ClaimedItem>(inflightPath);
        const idx = inflight.findIndex((i) => i.message.id === messageId);
        if (idx === -1) return false;

        const item = inflight[idx]!;
        inflight.splice(idx, 1);
        writeJsonl(inflightPath, inflight);

        if (item.attempts >= config.maxRetries) {
          // Move to dead letter
          appendJsonl(deadPath, item.message);
          log.warn("Message nacked, moved to dead-letter", { id: messageId });
        } else {
          // Return to pending with exponential backoff
          const backoff =
            config.retryBackoffMs * Math.pow(2, item.attempts - 1);
          const retryMsg: BusMessage = {
            ...item.message,
            notBefore: new Date(Date.now() + backoff).toISOString(),
          };
          appendJsonl(pendingPath, retryMsg);
          log.warn("Message nacked, returned to pending", { id: messageId });
        }
        return true;
      });
    },

    stats() {
      return {
        pending: readJsonl<BusMessage>(pendingPath).length,
        inflight: readJsonl<ClaimedItem>(inflightPath).length,
        dead: readJsonl<BusMessage>(deadPath).length,
      };
    },

    deadLetters() {
      return readJsonl<BusMessage>(deadPath);
    },

    drain() {
      return withFileLock(lockPath, () => {
        const pending = readJsonl<BusMessage>(pendingPath);
        const count = pending.length;
        for (const msg of pending) appendJsonl(deadPath, msg);
        writeJsonl(pendingPath, []);
        return count;
      });
    },
  };
}
