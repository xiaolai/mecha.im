import type { BotConfig } from "./config.js";
import type { BotInfo } from "./docker.types.js";
import * as docker from "./docker.js";
import { NativeProcessManager } from "./native.js";
import { getBot } from "./store.js";

export type { BotInfo };
export type Runtime = "docker" | "native";

export interface ProcessManager {
  spawn(config: BotConfig, botPath?: string): Promise<string>;
  start(name: string): Promise<void>;
  stop(name: string): Promise<void>;
  restart(name: string): Promise<string>;
  remove(name: string): Promise<void>;
  list(): Promise<BotInfo[]>;
  logs(name: string, follow: boolean): Promise<void>;
  readonly runtime: Runtime;
}

const nativeManager = new NativeProcessManager();

const dockerAdapter: ProcessManager = {
  runtime: "docker",
  spawn: docker.spawn,
  start: docker.start,
  stop: docker.stop,
  restart: docker.restart,
  remove: docker.remove,
  list: async () => (await docker.list()).map(b => ({ ...b, runtime: "docker" as const })),
  logs: docker.logs,
};

export function getManager(runtime: Runtime): ProcessManager {
  return runtime === "native" ? nativeManager : dockerAdapter;
}

/** Get the correct manager for an existing bot by reading its registry entry */
export function getManagerForBot(name: string): ProcessManager {
  const entry = getBot(name);
  return getManager(entry?.runtime ?? "docker");
}

/** List all bots across both runtimes */
export async function listAllBots(): Promise<BotInfo[]> {
  const [dockerBots, nativeBots] = await Promise.all([
    dockerAdapter.list().catch(() => [] as BotInfo[]),
    nativeManager.list().catch(() => [] as BotInfo[]),
  ]);
  return [...dockerBots, ...nativeBots];
}
