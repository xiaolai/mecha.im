import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleWorkflowTool, type WorkflowToolOpts } from "../../src/mcp/workflow-tools.js";
import type { WorkflowDef, RunState } from "@mecha/workflow";

function makeWorkflowDef(overrides?: Partial<WorkflowDef>): WorkflowDef {
  return {
    name: "test-workflow",
    description: "A test workflow",
    steps: {
      step1: { bot: "alice", prompt: "Do step 1" },
    },
    ...overrides,
  };
}

function writeWorkflow(workflowsDir: string, name: string, def: WorkflowDef): void {
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(join(workflowsDir, `${name}.yaml`), JSON.stringify(def, null, 2));
}

function writeRunState(workflowsDir: string, wfName: string, run: RunState): void {
  const runsDir = join(workflowsDir, "runs", wfName);
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(runsDir, `${run.runId}.json`), JSON.stringify(run, null, 2));
}

describe("workflow_list", () => {
  let workflowsDir: string;

  beforeEach(() => {
    workflowsDir = mkdtempSync(join(tmpdir(), "wf-tools-test-"));
  });
  afterEach(() => { rmSync(workflowsDir, { recursive: true, force: true }); });

  it("lists available workflows", async () => {
    const opts: WorkflowToolOpts = { workflowsDir };
    writeWorkflow(workflowsDir, "deploy", makeWorkflowDef({ name: "deploy" }));
    writeWorkflow(workflowsDir, "review", makeWorkflowDef({ name: "review" }));

    const result = await handleWorkflowTool(opts, "workflow_list", {});

    expect(result.content[0].text).toContain("deploy");
    expect(result.content[0].text).toContain("review");
    expect(result.isError).toBeUndefined();
  });

  it("returns message when no workflows directory exists", async () => {
    const opts: WorkflowToolOpts = { workflowsDir: join(workflowsDir, "nonexistent") };
    const result = await handleWorkflowTool(opts, "workflow_list", {});

    expect(result.content[0].text).toBe("No workflows found");
    expect(result.isError).toBeUndefined();
  });

  it("returns message when workflows directory is empty", async () => {
    mkdirSync(workflowsDir, { recursive: true });
    const opts: WorkflowToolOpts = { workflowsDir };
    const result = await handleWorkflowTool(opts, "workflow_list", {});

    expect(result.content[0].text).toBe("No workflows found");
    expect(result.isError).toBeUndefined();
  });
});

describe("workflow_run", () => {
  let workflowsDir: string;

  beforeEach(() => {
    workflowsDir = mkdtempSync(join(tmpdir(), "wf-tools-test-"));
  });
  afterEach(() => { rmSync(workflowsDir, { recursive: true, force: true }); });

  it("starts a workflow run", async () => {
    const def = makeWorkflowDef({ name: "deploy" });
    writeWorkflow(workflowsDir, "deploy", def);
    const opts: WorkflowToolOpts = { workflowsDir };

    const result = await handleWorkflowTool(opts, "workflow_run", { name: "deploy" });

    expect(result.content[0].text).toContain('Started workflow "deploy"');
    expect(result.content[0].text).toContain("run ID:");
    expect(result.isError).toBeUndefined();
  });

  it("starts a workflow run with inputs", async () => {
    const def = makeWorkflowDef({
      name: "deploy",
      inputs: { env: { type: "string", default: "staging" } },
    });
    writeWorkflow(workflowsDir, "deploy", def);
    const opts: WorkflowToolOpts = { workflowsDir };

    const result = await handleWorkflowTool(opts, "workflow_run", {
      name: "deploy",
      inputs: { env: "production" },
    });

    expect(result.content[0].text).toContain('Started workflow "deploy"');
    expect(result.isError).toBeUndefined();
  });

  it("returns error when workflow name is missing", async () => {
    const opts: WorkflowToolOpts = { workflowsDir };
    const result = await handleWorkflowTool(opts, "workflow_run", {});

    expect(result.content[0].text).toContain("Missing required: name");
    expect(result.isError).toBe(true);
  });

  it("returns error when workflow name is empty", async () => {
    const opts: WorkflowToolOpts = { workflowsDir };
    const result = await handleWorkflowTool(opts, "workflow_run", { name: "" });

    expect(result.content[0].text).toContain("Missing required: name");
    expect(result.isError).toBe(true);
  });

  it("returns error when workflow does not exist", async () => {
    mkdirSync(workflowsDir, { recursive: true });
    const opts: WorkflowToolOpts = { workflowsDir };
    const result = await handleWorkflowTool(opts, "workflow_run", { name: "nonexistent" });

    expect(result.content[0].text).toContain('Workflow "nonexistent" not found');
    expect(result.isError).toBe(true);
  });

  it("handles null inputs gracefully", async () => {
    const def = makeWorkflowDef({ name: "deploy" });
    writeWorkflow(workflowsDir, "deploy", def);
    const opts: WorkflowToolOpts = { workflowsDir };

    const result = await handleWorkflowTool(opts, "workflow_run", { name: "deploy", inputs: null });

    expect(result.content[0].text).toContain('Started workflow "deploy"');
    expect(result.isError).toBeUndefined();
  });
});

describe("workflow_status", () => {
  let workflowsDir: string;

  beforeEach(() => {
    workflowsDir = mkdtempSync(join(tmpdir(), "wf-tools-test-"));
  });
  afterEach(() => { rmSync(workflowsDir, { recursive: true, force: true }); });

  it("returns run status", async () => {
    const run: RunState = {
      runId: "run-2025-01-01-abc12345",
      workflow: "deploy",
      status: "done",
      inputs: { env: "prod" },
      steps: {
        step1: { status: "completed", stepRunId: "sr-1", attempts: 1, costUsd: 0.01 },
      },
      startedAt: "2025-01-01T00:00:00Z",
      completedAt: "2025-01-01T00:01:00Z",
      totalCostUsd: 0.01,
    };
    writeRunState(workflowsDir, "deploy", run);
    const opts: WorkflowToolOpts = { workflowsDir };

    const result = await handleWorkflowTool(opts, "workflow_status", {
      workflow: "deploy",
      runId: "run-2025-01-01-abc12345",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.runId).toBe("run-2025-01-01-abc12345");
    expect(parsed.workflow).toBe("deploy");
    expect(parsed.status).toBe("done");
    expect(parsed.totalCostUsd).toBe(0.01);
    expect(parsed.steps.step1.status).toBe("completed");
  });

  it("returns error when run is not found", async () => {
    mkdirSync(workflowsDir, { recursive: true });
    const opts: WorkflowToolOpts = { workflowsDir };
    const result = await handleWorkflowTool(opts, "workflow_status", {
      workflow: "deploy",
      runId: "nonexistent-run",
    });

    expect(result.content[0].text).toContain('Run "nonexistent-run" not found');
    expect(result.isError).toBe(true);
  });

  it("returns error when workflow is missing", async () => {
    const opts: WorkflowToolOpts = { workflowsDir };
    const result = await handleWorkflowTool(opts, "workflow_status", { runId: "abc" });

    expect(result.content[0].text).toContain("Missing required: workflow");
    expect(result.isError).toBe(true);
  });

  it("returns error when workflow is empty string", async () => {
    const opts: WorkflowToolOpts = { workflowsDir };
    const result = await handleWorkflowTool(opts, "workflow_status", { workflow: "", runId: "abc" });

    expect(result.content[0].text).toContain("Missing required: workflow");
    expect(result.isError).toBe(true);
  });

  it("returns error when runId is missing", async () => {
    const opts: WorkflowToolOpts = { workflowsDir };
    const result = await handleWorkflowTool(opts, "workflow_status", { workflow: "deploy" });

    expect(result.content[0].text).toContain("Missing required: runId");
    expect(result.isError).toBe(true);
  });

  it("returns error when runId is empty string", async () => {
    const opts: WorkflowToolOpts = { workflowsDir };
    const result = await handleWorkflowTool(opts, "workflow_status", { workflow: "deploy", runId: "" });

    expect(result.content[0].text).toContain("Missing required: runId");
    expect(result.isError).toBe(true);
  });

  it("includes step error in status", async () => {
    const run: RunState = {
      runId: "run-failed",
      workflow: "deploy",
      status: "failed",
      inputs: {},
      steps: {
        step1: { status: "failed", stepRunId: "sr-1", attempts: 1, error: "timeout" },
      },
      startedAt: "2025-01-01T00:00:00Z",
      totalCostUsd: 0,
    };
    writeRunState(workflowsDir, "deploy", run);
    const opts: WorkflowToolOpts = { workflowsDir };

    const result = await handleWorkflowTool(opts, "workflow_status", {
      workflow: "deploy",
      runId: "run-failed",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("failed");
    expect(parsed.steps.step1.error).toBe("timeout");
  });
});

describe("unknown workflow tool", () => {
  it("returns error for unknown tool name", async () => {
    const workflowsDir = mkdtempSync(join(tmpdir(), "wf-tools-test-"));
    const opts: WorkflowToolOpts = { workflowsDir };
    const result = await handleWorkflowTool(opts, "workflow_unknown", {});

    expect(result.content[0].text).toContain("Unknown workflow tool");
    expect(result.isError).toBe(true);

    rmSync(workflowsDir, { recursive: true, force: true });
  });
});
