import type { ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import type { CasaName } from "@mecha/core";
import type { ProcessEvent } from "./events.js";

export interface SpawnOpts {
  name: CasaName;
  workspacePath: string;
  port?: number;
  env?: Record<string, string>;
  model?: string;
  permissionMode?: string;
  auth?: string;
  tags?: string[];
  runtimeBin?: string;
}

export interface ProcessInfo {
  name: CasaName;
  state: "running" | "stopped" | "error";
  pid?: number;
  port?: number;
  workspacePath: string;
  token?: string;
  startedAt?: string;
  stoppedAt?: string;
  exitCode?: number;
}

export interface LogOpts {
  follow?: boolean;
  tail?: number;
}

export interface ProcessManager {
  spawn(opts: SpawnOpts): Promise<ProcessInfo>;
  get(name: CasaName): ProcessInfo | undefined;
  list(): ProcessInfo[];
  stop(name: CasaName): Promise<void>;
  kill(name: CasaName): Promise<void>;
  logs(name: CasaName, opts?: LogOpts): Readable;
  getPortAndToken(name: CasaName): { port: number; token: string } | undefined;
  onEvent(handler: (event: ProcessEvent) => void): () => void;
}

export interface LiveProcess {
  child: ChildProcess;
  port: number;
  token: string;
  name: CasaName;
}

export interface CreateProcessManagerOpts {
  mechaDir: string;
  healthTimeoutMs?: number;
  spawnFn?: typeof import("node:child_process").spawn;
  /** Path to the @mecha/runtime entrypoint. Required for real spawning. */
  runtimeEntrypoint?: string;
}
