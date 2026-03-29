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

// CLI-based backends return this to build a spawn command
export interface BackendCommand {
  command: string;
  args: string[];
}

// SDK-based backends implement this directly
export type BackendExecutor = (prompt: string) => Promise<TaskResponse>;
