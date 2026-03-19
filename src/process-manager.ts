import type { BotConfig } from "./config.js";
import type { BotInfo } from "./docker.types.js";

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
