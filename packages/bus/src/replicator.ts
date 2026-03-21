import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BusMessage } from "./types.js";
import { createTopic } from "./topic.js";

/** Options for creating a bus replicator. */
export interface ReplicatorOpts {
  busDir: string;
  mechaDir: string;
  topicName: string;
  targetNodes: string[];
}

/** Replicator state tracking cursors per node. */
interface ReplicatorState {
  cursors: Record<string, number>;
}

/** Result of a single replication cycle. */
export interface ReplicationResult {
  sent: number;
  errors: string[];
}

/** Cross-node bus replicator that forwards topic messages to remote nodes. */
export interface Replicator {
  /** Run one replication cycle: poll new messages and forward to remotes. */
  replicate(): Promise<ReplicationResult>;

  /** Start periodic replication. */
  startReplication(intervalMs: number): void;

  /** Stop periodic replication. */
  stopReplication(): void;

  /** Whether replication is active. */
  readonly active: boolean;
}

/** Fetch function signature for dependency injection (matches agentFetch pattern). */
export type ReplicatorFetchFn = (opts: {
  node: { name: string; host: string; port: number; apiKey: string };
  path: string;
  method: string;
  body: unknown;
  allowPrivateHosts?: boolean;
}) => Promise<{ ok: boolean; status: number }>;

/**
 * Create a replicator that monitors a local topic for new messages
 * and forwards them to remote nodes via a fetch function.
 */
export function createReplicator(
  opts: ReplicatorOpts,
  fetchFn: ReplicatorFetchFn,
  readNodesFn: (mechaDir: string) => Array<{ name: string; host: string; port: number; apiKey: string }>,
): Replicator {
  const { busDir, mechaDir, topicName, targetNodes } = opts;

  // Ensure the topic directory exists (side-effect only)
  createTopic({
    busDir,
    config: { name: topicName, retentionDays: 7 },
  });

  const statePath = join(busDir, "topics", topicName, "replicator.json");

  function loadState(): ReplicatorState {
    if (!existsSync(statePath)) return { cursors: {} };
    return JSON.parse(readFileSync(statePath, "utf-8")) as ReplicatorState;
  }

  function saveState(state: ReplicatorState): void {
    writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  }

  /** Read all messages from the topic's JSONL file directly. */
  function readAllMessages(): BusMessage[] {
    const messagesPath = join(busDir, "topics", topicName, "messages.jsonl");
    if (!existsSync(messagesPath)) return [];
    const content = readFileSync(messagesPath, "utf-8").trim();
    if (!content) return [];
    return content.split("\n").map((line) => JSON.parse(line) as BusMessage);
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  let isReplicating = false;

  const replicator: Replicator = {
    get active() {
      return timer !== null;
    },

    async replicate(): Promise<ReplicationResult> {
      const state = loadState();
      const allMessages = readAllMessages();
      const allNodes = readNodesFn(mechaDir);
      const result: ReplicationResult = { sent: 0, errors: [] };

      for (const nodeName of targetNodes) {
        const node = allNodes.find((n) => n.name === nodeName);
        if (!node) {
          result.errors.push(`Node "${nodeName}" not found in registry`);
          continue;
        }

        const cursor = state.cursors[nodeName] ?? 0;
        const newMessages = allMessages.slice(cursor);

        for (const msg of newMessages) {
          // Skip messages that originated from a remote node (avoid loops)
          const payload = msg.payload as Record<string, unknown> | null;
          if (payload && typeof payload === "object" && "origin" in payload) {
            // Message has an origin field — it came from a remote, skip
            state.cursors[nodeName] = (state.cursors[nodeName] ?? 0) + 1;
            continue;
          }

          try {
            const res = await fetchFn({
              node,
              path: `/bus/topics/${encodeURIComponent(topicName)}/publish`,
              method: "POST",
              body: {
                sender: msg.sender,
                payload: { ...((typeof payload === "object" && payload) ? payload : { data: msg.payload }), origin: "local" },
                id: msg.id,
              },
              allowPrivateHosts: true,
            });

            if (res.ok) {
              result.sent++;
              state.cursors[nodeName] = (state.cursors[nodeName] ?? 0) + 1;
            } else {
              result.errors.push(`Failed to forward msg ${msg.id} to ${nodeName}: HTTP ${res.status}`);
              break; // Stop forwarding to this node on failure
            }
          } catch (err) {
            /* v8 ignore start -- network error shape */
            const errMsg = err instanceof Error ? err.message : String(err);
            /* v8 ignore stop */
            result.errors.push(`Failed to forward msg ${msg.id} to ${nodeName}: ${errMsg}`);
            break; // Stop forwarding to this node on failure
          }
        }
      }

      saveState(state);
      return result;
    },

    startReplication(intervalMs: number): void {
      if (timer) return;
      timer = setInterval(() => {
        if (isReplicating) return;
        isReplicating = true;
        void replicator.replicate().finally(() => {
          isReplicating = false;
        });
      }, intervalMs);
    },

    stopReplication(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };

  return replicator;
}
