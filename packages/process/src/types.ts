import type { ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import type { BotName, SandboxMode } from "@mecha/core";
import type { Sandbox } from "@mecha/sandbox";
import type { ProcessEvent } from "./events.js";
import type { ProcessEventEmitter } from "./events.js";

/** Options for spawning a new bot process. */
export interface SpawnOpts {
  name: BotName;
  workspacePath: string;
  port?: number;
  env?: Record<string, string>;
  model?: string;
  permissionMode?: string;
  auth?: string | null;
  tags?: string[];
  expose?: string[];
  runtimeBin?: string;
  sandboxMode?: SandboxMode;
  meterOff?: boolean;
  home?: string;
  // LLM behavior
  systemPrompt?: string;
  appendSystemPrompt?: string;
  effort?: "low" | "medium" | "high";
  maxBudgetUsd?: number;
  // Tool control
  allowedTools?: string[];
  disallowedTools?: string[];
  tools?: string[];
  // Agent identity
  agent?: string;
  agents?: Record<string, { description: string; prompt: string }>;
  // Session behavior
  sessionPersistence?: boolean;
  budgetLimit?: number;
  // MCP
  mcpServers?: Record<string, unknown>;
  mcpConfigFiles?: string[];
  strictMcpConfig?: boolean;
  disableSlashCommands?: boolean;
  // Permission overrides
  dangerouslySkipPermissions?: boolean;
  allowDangerouslySkipPermissions?: boolean;
  // Model fallback
  fallbackModel?: string;
  // Environment
  addDirs?: string[];
}

/** Snapshot of a bot process's current state and metadata. */
export interface ProcessInfo {
  name: BotName;
  state: "running" | "stopped" | "error";
  pid?: number;
  port?: number;
  workspacePath: string;
  token?: string;
  startedAt?: string;
  stoppedAt?: string;
  exitCode?: number;
}

/** Options for reading bot process logs. */
export interface LogOpts {
  follow?: boolean;
  tail?: number;
}

/** Core interface for managing bot process lifecycle (spawn, stop, kill, logs). */
export interface ProcessManager {
  spawn(opts: SpawnOpts): Promise<ProcessInfo>;
  get(name: BotName): ProcessInfo | undefined;
  list(): ProcessInfo[];
  stop(name: BotName): Promise<void>;
  kill(name: BotName): Promise<void>;
  logs(name: BotName, opts?: LogOpts): Readable;
  getPortAndToken(name: BotName): { port: number; token: string } | undefined;
  onEvent(handler: (event: ProcessEvent) => void): () => void;
}

/** In-memory handle to a running bot child process. */
export interface LiveProcess {
  child: ChildProcess;
  port: number;
  token: string;
  name: BotName;
}

/** Configuration for creating a ProcessManager instance. */
export interface CreateProcessManagerOpts {
  mechaDir: string;
  healthTimeoutMs?: number;
  spawnFn?: typeof import("node:child_process").spawn;
  /** Path to the @mecha/runtime entrypoint (used with node). */
  runtimeEntrypoint?: string;
  /** Path to a standalone runtime binary (takes precedence over runtimeEntrypoint). */
  runtimeBin?: string;
  /** Extra args passed before any spawn args when using runtimeBin (e.g. ["__runtime"]). */
  runtimeArgs?: string[];
  /** Sandbox instance for kernel-level isolation (Phase 5) */
  sandbox?: Sandbox;
}

/** Shared context passed through the spawn pipeline. */
export interface SpawnContext {
  opts: CreateProcessManagerOpts;
  mechaDir: string;
  healthTimeoutMs: number;
  sandbox?: Sandbox;
  spawnFn: typeof import("node:child_process").spawn;
  emitter: ProcessEventEmitter;
  live: Map<string, LiveProcess>;
  botDir: (name: string) => string;
  /** Called after state changes that affect the discovery index. */
  onStateChange?: () => void;
}
