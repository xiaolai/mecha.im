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

export interface BackendCommand {
  command: string;
  args: string[];
}
