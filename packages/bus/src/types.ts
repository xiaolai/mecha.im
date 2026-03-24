/** A bus message with unique ID for idempotency. */
export interface BusMessage {
  id: string;
  ts: string;
  sender: string;
  payload: unknown;
  /** Earliest time this message can be claimed (set by nack with backoff). */
  notBefore?: string;
}

/** Queue configuration. */
export interface QueueConfig {
  name: string;
  maxRetries: number;
  retryBackoffMs: number;
  claimTimeoutMs?: number;
}

/** A claimed queue item with metadata. */
export interface ClaimedItem {
  message: BusMessage;
  claimedBy: string;
  claimedAt: string;
  attempts: number;
}

/** Topic subscriber configuration. */
export interface Subscriber {
  bot: string;
  cursor: number;
  concurrency: number;
  promptTemplate?: string;
  filter?: string;
}

/** Topic configuration. */
export interface TopicConfig {
  name: string;
  retentionDays: number;
}

/** Bus configuration file (bus.json). */
export interface BusConfig {
  queues: Record<string, QueueConfig>;
  topics: Record<string, TopicConfig>;
}
