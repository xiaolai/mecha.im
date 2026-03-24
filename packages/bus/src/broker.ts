import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteSync } from "@mecha/core";
import type { BusConfig, QueueConfig, TopicConfig } from "./types.js";
import { createQueue, type DurableQueue } from "./queue.js";
import { createTopic, type Topic } from "./topic.js";

/** Message broker managing queues and topics. */
export interface Broker {
  /** Create or get a durable queue. */
  queue(name: string, config?: Partial<Omit<QueueConfig, "name">>): DurableQueue;

  /** Create or get a pub/sub topic. */
  topic(name: string, config?: Partial<Omit<TopicConfig, "name">>): Topic;

  /** List all queue names. */
  queueNames(): string[];

  /** List all topic names. */
  topicNames(): string[];

  /** The bus directory path. */
  readonly busDir: string;
}

const DEFAULT_QUEUE_CONFIG: Omit<QueueConfig, "name"> = {
  maxRetries: 3,
  retryBackoffMs: 5000,
};

const DEFAULT_TOPIC_CONFIG: Omit<TopicConfig, "name"> = {
  retentionDays: 7,
};

/**
 * Create a message broker backed by a bus directory.
 * Manages queues and topics. Config persists to bus.json.
 */
export function createBroker(busDir: string): Broker {
  mkdirSync(busDir, { recursive: true });
  const configPath = join(busDir, "bus.json");

  function loadConfig(): BusConfig {
    if (!existsSync(configPath)) return { queues: {}, topics: {} };
    try {
      return JSON.parse(readFileSync(configPath, "utf-8")) as BusConfig;
    } catch {
      // Corrupt config file — treat as empty
      return { queues: {}, topics: {} };
    }
  }

  function saveConfig(config: BusConfig): void {
    atomicWriteSync(configPath, JSON.stringify(config, null, 2) + "\n");
  }

  const queues = new Map<string, DurableQueue>();
  const topics = new Map<string, Topic>();

  // Hydrate from existing config
  const cfg = loadConfig();
  for (const [name, qc] of Object.entries(cfg.queues)) {
    queues.set(name, createQueue({ busDir, config: qc }));
  }
  for (const [name, tc] of Object.entries(cfg.topics)) {
    topics.set(name, createTopic({ busDir, config: tc }));
  }

  return {
    busDir,

    queue(name, partial) {
      const existing = queues.get(name);
      if (existing) return existing;

      const config: QueueConfig = { name, ...DEFAULT_QUEUE_CONFIG, ...partial };
      const q = createQueue({ busDir, config });
      queues.set(name, q);

      const c = loadConfig();
      c.queues[name] = config;
      saveConfig(c);

      return q;
    },

    topic(name, partial) {
      const existing = topics.get(name);
      if (existing) return existing;

      const config: TopicConfig = { name, ...DEFAULT_TOPIC_CONFIG, ...partial };
      const t = createTopic({ busDir, config });
      topics.set(name, t);

      const c = loadConfig();
      c.topics[name] = config;
      saveConfig(c);

      return t;
    },

    queueNames() {
      return [...queues.keys()];
    },

    topicNames() {
      return [...topics.keys()];
    },
  };
}
