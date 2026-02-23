import type { MechaId, MechaState } from "@mecha/core";

/** Options for spawning a new Mecha process. */
export interface SpawnOpts {
  mechaId: MechaId;
  /** Absolute path to the project directory. */
  projectPath: string;
  /** Host port for the runtime HTTP server. */
  port: number;
  /** Directory for CLAUDE_CONFIG_DIR (isolates conversation history). */
  claudeConfigDir: string;
  /** Pre-generated auth token for the runtime. */
  authToken: string;
  /** Additional environment variables (ANTHROPIC_API_KEY, etc.). */
  env?: Record<string, string>;
  /** Permission mode for the agent. */
  permissionMode?: string;
  /** Whether to enable sandbox (default: true). */
  sandboxEnabled?: boolean;
}

/** Persisted info about a running or stopped Mecha process. */
export interface MechaProcessInfo {
  id: MechaId;
  pid: number;
  port: number;
  projectPath: string;
  state: MechaState;
  authToken: string;
  env: Record<string, string>;
  createdAt: string;
  startedAt?: string;
  /** `${pid}:${startTime}` — detects PID reuse after the OS recycles a PID. */
  startFingerprint: string;
}

/** Event emitted by the process manager. */
export interface ProcessEvent {
  type: "start" | "stop" | "exit" | "error";
  mechaId: string;
  pid?: number;
  exitCode?: number;
  timestamp: number;
}

/** Log stream options. */
export interface LogStreamOpts {
  /** Number of lines from the end to return (default: 100). */
  tail?: number;
  /** If true, keep streaming new lines. */
  follow?: boolean;
}

/** The ProcessManager interface — replaces DockerClient in all consumers. */
export interface ProcessManager {
  spawn(opts: SpawnOpts): Promise<MechaProcessInfo>;
  stop(id: string): Promise<void>;
  kill(id: string, force?: boolean): Promise<void>;
  get(id: string): MechaProcessInfo | undefined;
  list(): MechaProcessInfo[];
  logs(id: string, opts?: LogStreamOpts): NodeJS.ReadableStream;
  getPortAndEnv(id: string): { port: number | undefined; env: Record<string, string> };
  onEvent(handler: (event: ProcessEvent) => void): () => void;
}
