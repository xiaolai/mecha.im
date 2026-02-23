/** Branded string type for Mecha IDs (format: mx-<slug>-<pathhash>) */
export type MechaId = string & { readonly __brand: "MechaId" };

/** Configuration for creating a Mecha instance */
export interface MechaConfig {
  /** Absolute path to the project directory on the host */
  projectPath: string;
  /** Optional human-friendly name override */
  name?: string;
  /** Security profile */
  profile?: "default" | "strict";
  /** Optional explicit ID override */
  id?: MechaId;
  /** Port mapping for the runtime HTTP server */
  port?: number;
  /** Whether to enable sandbox (default: true). */
  sandboxEnabled?: boolean;
}

/** Possible states of a Mecha process */
export type MechaState =
  | "creating"
  | "running"
  | "stopped"
  | "removing"
  | "error"
  | "not_found";

/** Full info about a Mecha instance */
export interface MechaInfo {
  id: MechaId;
  state: MechaState;
  projectPath: string;
  port?: number;
  pid?: number;
  createdAt?: string;
  startedAt?: string;
}

/** Heartbeat payload emitted by a running Mecha */
export interface MechaHeartbeat {
  id: MechaId;
  status: MechaState;
  activeTaskCount: number;
  lastToolCall?: string;
  memoryPressure?: number;
  timestamp: string;
}

/** Mesh-scoped mecha reference. */
export interface MechaRef {
  /** Node name: "local" for the current machine, or a registered node name. */
  node: string;
  /** Mecha ID on that node (e.g. "mx-myproject-abc123"). */
  id: string;
}

/** Global CLI option flags */
export interface GlobalOptions {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  noColor?: boolean;
}
