import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createEngine, type RunState } from "@mecha/workflow";

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP tool definitions for workflow operations (list, run, status). */
export const WORKFLOW_TOOLS: McpToolDef[] = [
  {
    name: "workflow_list",
    description: "List available workflows",
    inputSchema: {
      type: "object",
    },
  },
  {
    name: "workflow_run",
    description: "Start a workflow run",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Workflow name" },
        inputs: { type: "object", description: "Input values for the workflow (optional)" },
      },
      required: ["name"],
    },
  },
  {
    name: "workflow_status",
    description: "Get status of a workflow run",
    inputSchema: {
      type: "object",
      properties: {
        workflow: { type: "string", description: "Workflow name" },
        runId: { type: "string", description: "Run ID" },
      },
      required: ["workflow", "runId"],
    },
  },
];

/** Runtime context for workflow tool execution. */
export interface WorkflowToolOpts {
  workflowsDir: string;
}

interface WorkflowResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/** Find the run state file by run ID across all workflow run dirs. */
function findRunFile(workflowsDir: string, workflow: string, runId: string): string | undefined {
  const candidate = join(workflowsDir, "runs", workflow, `${runId}.json`);
  if (existsSync(candidate)) return candidate;
  return undefined;
}

/** Dispatch a workflow tool call and return the MCP result. */
export async function handleWorkflowTool(
  opts: WorkflowToolOpts,
  name: string,
  args: Record<string, unknown>,
): Promise<WorkflowResult> {
  const { workflowsDir } = opts;

  switch (name) {
    case "workflow_list": {
      if (!existsSync(workflowsDir)) {
        return { content: [{ type: "text", text: "No workflows found" }] };
      }
      const files = readdirSync(workflowsDir).filter((f) => f.endsWith(".yaml"));
      if (files.length === 0) {
        return { content: [{ type: "text", text: "No workflows found" }] };
      }
      const names = files.map((f) => f.replace(/\.yaml$/, ""));
      return { content: [{ type: "text", text: names.join("\n") }] };
    }

    case "workflow_run": {
      const wfName = args.name;
      if (typeof wfName !== "string" || !wfName) {
        return { content: [{ type: "text", text: "Missing required: name (string)" }], isError: true };
      }
      const defPath = join(workflowsDir, `${wfName}.yaml`);
      if (!existsSync(defPath)) {
        return { content: [{ type: "text", text: `Workflow "${wfName}" not found` }], isError: true };
      }
      let definition;
      try {
        definition = JSON.parse(readFileSync(defPath, "utf-8"));
      /* v8 ignore start -- corrupt workflow file fallback */
      } catch {
        return { content: [{ type: "text", text: `Failed to parse workflow "${wfName}"` }], isError: true };
      }
      /* v8 ignore stop */
      const inputs = (typeof args.inputs === "object" && args.inputs !== null ? args.inputs : {}) as Record<string, unknown>;
      const engine = createEngine({ workflowsDir, definition });
      const runId = engine.startRun(inputs);
      return { content: [{ type: "text", text: `Started workflow "${wfName}" with run ID: ${runId}` }] };
    }

    case "workflow_status": {
      const workflow = args.workflow;
      const runId = args.runId;
      if (typeof workflow !== "string" || !workflow) {
        return { content: [{ type: "text", text: "Missing required: workflow (string)" }], isError: true };
      }
      if (typeof runId !== "string" || !runId) {
        return { content: [{ type: "text", text: "Missing required: runId (string)" }], isError: true };
      }
      const filePath = findRunFile(workflowsDir, workflow, runId);
      if (!filePath) {
        return { content: [{ type: "text", text: `Run "${runId}" not found for workflow "${workflow}"` }], isError: true };
      }
      const raw = readFileSync(filePath, "utf-8");
      const run = JSON.parse(raw) as RunState;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            runId: run.runId,
            workflow: run.workflow,
            status: run.status,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
            totalCostUsd: run.totalCostUsd,
            steps: Object.fromEntries(
              Object.entries(run.steps).map(([stepName, step]) => [
                stepName,
                { status: step.status, attempts: step.attempts, error: step.error },
              ]),
            ),
          }),
        }],
      };
    }

    default:
      return { content: [{ type: "text", text: `Unknown workflow tool: ${name}` }], isError: true };
  }
}
