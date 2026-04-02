/** Inbound task request from the mecha Go orchestrator via POST /task. */
export interface TaskRequest {
  id: string;
  prompt: string;
  context?: {
    repo?: string;
    ref?: string;
    files?: string[];
    diff?: string;
    [key: string]: unknown;
  };
}

/** Outbound task result — matches the Go result contract (internal/policies/result.go). All fields optional except output. */
export interface TaskResponse {
  output: string;
  comment?: { target: string; body: string };
  labels?: { add?: string[]; remove?: string[] };
  status?: { state: string; description: string };
  commit?: { message: string; diff: string };
  metadata?: {
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    duration_ms?: number;
    exit_code?: number;
  };
}

/** Backend executor function — the Claude backend implements this via Agent SDK query(). */
export type BackendExecutor = (prompt: string) => Promise<TaskResponse>;
