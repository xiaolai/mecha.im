import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { BusMessage, Subscriber, TopicConfig } from "./types.js";

/** Validate a name used as a filesystem path segment. Rejects traversal attempts. */
function assertSafeName(name: string, label: string): void {
  if (!name || /[/\\]|^\.\.?$/.test(name) || name.includes("..")) {
    throw new Error(`Invalid ${label} name: "${name}"`);
  }
}

/** Parse JSONL file into array of objects. */
function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf-8").trim();
  if (!content) return [];
  return content.split("\n").map((line) => JSON.parse(line) as T);
}

/** Pub/sub topic with per-subscriber cursors. */
export interface Topic {
  /** Publish a message to the topic. Returns message ID. Deduplicates by ID. */
  publish(msg: Omit<BusMessage, "id" | "ts"> & { id?: string }): string;

  /** Add a subscriber. */
  subscribe(sub: Omit<Subscriber, "cursor">): void;

  /** Remove a subscriber. */
  unsubscribe(bot: string): boolean;

  /** Read messages for a subscriber (from their cursor). Advances cursor. */
  poll(bot: string, limit?: number): BusMessage[];

  /** List all subscribers. */
  subscribers(): Subscriber[];

  /** Count total messages in the topic. */
  messageCount(): number;

  /** Remove messages older than retentionDays. Returns count of removed messages. */
  enforceRetention(): number;

  /** Get the topic name. */
  readonly name: string;
}

/** Options for creating a pub/sub topic. */
export interface CreateTopicOpts {
  busDir: string;
  config: TopicConfig;
}

/**
 * Create a pub/sub topic backed by JSONL files.
 * All writes are serialized (single caller — the daemon process).
 */
export function createTopic(opts: CreateTopicOpts): Topic {
  const { config } = opts;
  assertSafeName(config.name, "topic");
  const topicDir = join(opts.busDir, "topics", config.name);
  mkdirSync(topicDir, { recursive: true });

  const messagesPath = join(topicDir, "messages.jsonl");
  const subscribersPath = join(topicDir, "subscribers.json");

  const seenIds = new Set<string>();
  // Load existing IDs for dedup
  for (const msg of readJsonl<BusMessage>(messagesPath)) seenIds.add(msg.id);

  function loadSubscribers(): Subscriber[] {
    if (!existsSync(subscribersPath)) return [];
    return JSON.parse(readFileSync(subscribersPath, "utf-8")) as Subscriber[];
  }

  function saveSubscribers(subs: Subscriber[]): void {
    writeFileSync(subscribersPath, JSON.stringify(subs, null, 2) + "\n");
  }

  return {
    name: config.name,

    publish(partial) {
      const id = partial.id ?? randomUUID();
      if (seenIds.has(id)) return id;
      seenIds.add(id);

      const msg: BusMessage = {
        id,
        ts: new Date().toISOString(),
        sender: partial.sender,
        payload: partial.payload,
      };
      const line = JSON.stringify(msg) + "\n";
      writeFileSync(messagesPath, line, { flag: "a" });
      return id;
    },

    subscribe(sub) {
      const subs = loadSubscribers();
      const existing = subs.find((s) => s.bot === sub.bot);
      if (existing) {
        existing.concurrency = sub.concurrency;
        existing.promptTemplate = sub.promptTemplate;
        existing.filter = sub.filter;
      } else {
        // New subscriber starts at current end of messages
        const count = readJsonl<BusMessage>(messagesPath).length;
        subs.push({ ...sub, cursor: count });
      }
      saveSubscribers(subs);
    },

    unsubscribe(bot) {
      const subs = loadSubscribers();
      const idx = subs.findIndex((s) => s.bot === bot);
      if (idx === -1) return false;
      subs.splice(idx, 1);
      saveSubscribers(subs);
      return true;
    },

    poll(bot, limit = 10) {
      const subs = loadSubscribers();
      const sub = subs.find((s) => s.bot === bot);
      if (!sub) return [];

      // Enforce subscriber concurrency cap
      const effectiveLimit = sub.concurrency > 0
        ? Math.min(limit, sub.concurrency)
        : limit;

      const messages = readJsonl<BusMessage>(messagesPath);
      const batch = messages.slice(sub.cursor, sub.cursor + effectiveLimit);
      if (batch.length > 0) {
        sub.cursor += batch.length;
        saveSubscribers(subs);
      }
      return batch;
    },

    subscribers() {
      return loadSubscribers();
    },

    messageCount() {
      return readJsonl<BusMessage>(messagesPath).length;
    },

    enforceRetention() {
      const cutoffMs = config.retentionDays * 86_400_000;
      const cutoff = Date.now() - cutoffMs;
      const messages = readJsonl<BusMessage>(messagesPath);
      const kept = messages.filter((m) => new Date(m.ts).getTime() >= cutoff);
      const removed = messages.length - kept.length;
      if (removed > 0) {
        writeFileSync(
          messagesPath,
          kept.map((m) => JSON.stringify(m)).join("\n") +
            (kept.length ? "\n" : ""),
        );
      }
      return removed;
    },
  };
}
