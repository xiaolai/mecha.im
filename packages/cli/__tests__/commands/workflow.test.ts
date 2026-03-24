import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/program.js";
import { makeDeps } from "../test-utils.js";
import type { WorkflowDef, RunState } from "@mecha/workflow";

function makeWorkflowDef(overrides: Partial<WorkflowDef> = {}): WorkflowDef {
  return {
    name: "test-workflow",
    description: "A test workflow",
    steps: {
      research: {
        bot: "researcher",
        prompt: "Research the topic",
      },
      write: {
        bot: "writer",
        prompt: "Write based on research",
        depends: ["research"],
      },
    },
    ...overrides,
  };
}

function writeWorkflow(workflowsDir: string, name: string, def: WorkflowDef): void {
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(join(workflowsDir, `${name}.yaml`), JSON.stringify(def, null, 2));
}

function makeRunState(overrides: Partial<RunState> = {}): RunState {
  return {
    runId: "run-2026-01-01-abc12345",
    workflow: "test-workflow",
    status: "done",
    inputs: {},
    steps: {
      research: {
        status: "completed",
        stepRunId: "run-2026-01-01-abc12345:research:def456",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:01:00.000Z",
        output: "Research results",
        attempts: 1,
        costUsd: 0.05,
      },
      write: {
        status: "completed",
        stepRunId: "run-2026-01-01-abc12345:write:ghi789",
        startedAt: "2026-01-01T00:01:00.000Z",
        completedAt: "2026-01-01T00:02:00.000Z",
        output: "Written article",
        attempts: 1,
        costUsd: 0.03,
      },
    },
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:02:00.000Z",
    totalCostUsd: 0.08,
    ...overrides,
  };
}

function writeRunState(workflowsDir: string, wfName: string, run: RunState): void {
  const runsDir = join(workflowsDir, "runs", wfName);
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(runsDir, `${run.runId}.json`), JSON.stringify(run, null, 2));
  // Also write the definition snapshot
  writeFileSync(
    join(runsDir, `${run.runId}.yaml`),
    JSON.stringify(makeWorkflowDef({ name: wfName }), null, 2),
  );
}

describe("workflow list", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("shows message when no workflows directory", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    mkdirSync(mechaDir, { recursive: true });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "list"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No workflows directory found");
  });

  it("shows message when no yaml files", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    const workflowsDir = join(mechaDir, "workflows");
    mkdirSync(workflowsDir, { recursive: true });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "list"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("No workflows found");
  });

  it("lists workflow files", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    const workflowsDir = join(mechaDir, "workflows");
    writeWorkflow(workflowsDir, "deploy", makeWorkflowDef({ name: "deploy" }));
    writeWorkflow(workflowsDir, "review", makeWorkflowDef({ name: "review" }));

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "list"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Name", "File"],
      expect.arrayContaining([
        ["deploy", "deploy.yaml"],
        ["review", "review.yaml"],
      ]),
    );
  });
});

describe("workflow show", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("shows error when workflow not found", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    mkdirSync(mechaDir, { recursive: true });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "show", "nonexistent"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
    );
  });

  it("shows workflow definition", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    const workflowsDir = join(mechaDir, "workflows");
    const def = makeWorkflowDef({ name: "deploy", description: "Deploy pipeline" });
    writeWorkflow(workflowsDir, "deploy", def);

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "show", "deploy"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("Workflow: deploy");
    expect(deps.formatter.info).toHaveBeenCalledWith("Description: Deploy pipeline");
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("research: bot=researcher"),
    );
  });

  it("outputs JSON when --json flag set", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    const workflowsDir = join(mechaDir, "workflows");
    const def = makeWorkflowDef({ name: "deploy" });
    writeWorkflow(workflowsDir, "deploy", def);

    const deps = makeDeps({ mechaDir });
    (deps.formatter as any).isJson = true;
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "show", "deploy"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(
      expect.objectContaining({ name: "deploy" }),
    );
  });
});

describe("workflow runs", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("shows message when no runs found", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    mkdirSync(mechaDir, { recursive: true });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "runs", "test-workflow"]);
    expect(deps.formatter.info).toHaveBeenCalledWith(
      expect.stringContaining("No runs found"),
    );
  });

  it("lists runs for a workflow", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    const workflowsDir = join(mechaDir, "workflows");
    const run = makeRunState();
    writeRunState(workflowsDir, "test-workflow", run);

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "runs", "test-workflow"]);
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Run ID", "Status", "Started", "Cost"],
      expect.arrayContaining([
        expect.arrayContaining(["run-2026-01-01-abc12345", "done"]),
      ]),
    );
  });

  it("outputs JSON when --json flag set", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    const workflowsDir = join(mechaDir, "workflows");
    writeRunState(workflowsDir, "test-workflow", makeRunState());

    const deps = makeDeps({ mechaDir });
    (deps.formatter as any).isJson = true;
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "runs", "test-workflow"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ runId: "run-2026-01-01-abc12345" }),
      ]),
    );
  });

  it("limits output with --last flag", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    const workflowsDir = join(mechaDir, "workflows");

    // Create 5 run state files with different timestamps
    for (let i = 1; i <= 5; i++) {
      const run = makeRunState({
        runId: `run-2026-01-0${i}-abc`,
        startedAt: `2026-01-0${i}T00:00:00.000Z`,
        completedAt: `2026-01-0${i}T00:02:00.000Z`,
      });
      writeRunState(workflowsDir, "test-workflow", run);
    }

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "runs", "test-workflow", "--last", "2"]);
    expect(deps.formatter.table).toHaveBeenCalled();
    const rows = (deps.formatter.table as ReturnType<typeof import("vitest").vi.fn>).mock.calls[0][1];
    expect(rows).toHaveLength(2);
  });
});

describe("workflow run-detail", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("shows error when run not found", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    mkdirSync(mechaDir, { recursive: true });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "run-detail", "nonexistent"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
    );
  });

  it("shows run details", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    const workflowsDir = join(mechaDir, "workflows");
    const run = makeRunState();
    writeRunState(workflowsDir, "test-workflow", run);

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "run-detail", "run-2026-01-01-abc12345"]);
    expect(deps.formatter.info).toHaveBeenCalledWith("Run: run-2026-01-01-abc12345");
    expect(deps.formatter.info).toHaveBeenCalledWith("Workflow: test-workflow");
    expect(deps.formatter.info).toHaveBeenCalledWith("Status: done");
    expect(deps.formatter.table).toHaveBeenCalledWith(
      ["Step", "Status", "Cost", "Duration", "Error"],
      expect.any(Array),
    );
  });

  it("outputs JSON when --json flag set", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    const workflowsDir = join(mechaDir, "workflows");
    writeRunState(workflowsDir, "test-workflow", makeRunState());

    const deps = makeDeps({ mechaDir });
    (deps.formatter as any).isJson = true;
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "run-detail", "run-2026-01-01-abc12345"]);
    expect(deps.formatter.json).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-2026-01-01-abc12345" }),
    );
  });
});

describe("workflow run", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("shows error when workflow not found", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    mkdirSync(mechaDir, { recursive: true });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "run", "nonexistent"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
    );
  });

  it("runs a workflow to completion", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    const workflowsDir = join(mechaDir, "workflows");
    const def = makeWorkflowDef({
      name: "simple",
      steps: {
        only: {
          bot: "helper",
          prompt: "Do the thing",
        },
      },
    });
    writeWorkflow(workflowsDir, "simple", def);

    // Mock botChat by mocking the processManager.getPortAndToken
    const deps = makeDeps({
      mechaDir,
      pm: {
        getPortAndToken: (() => ({ port: 7700, token: "test-token" })) as never,
      },
    });

    // We need to intercept fetch. Use a simpler approach: the executor
    // inside workflow-run.ts uses botChat which calls fetch.
    // For this test, we can mock at the global fetch level.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        response: "Done!",
        sessionId: "sess-1",
        durationMs: 100,
        costUsd: 0.01,
      }),
    })) as unknown as typeof fetch;

    try {
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync(["node", "mecha", "workflow", "run", "simple"]);
      expect(deps.formatter.info).toHaveBeenCalledWith(
        expect.stringContaining("Started run:"),
      );
      expect(deps.formatter.info).toHaveBeenCalledWith(
        expect.stringContaining("done"),
      );

      // Verify run state file was created
      const runsDir = join(workflowsDir, "runs", "simple");
      const runFiles = require("node:fs").readdirSync(runsDir).filter((f: string) => f.endsWith(".json"));
      expect(runFiles.length).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles --input key=value flags", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    const workflowsDir = join(mechaDir, "workflows");
    const def = makeWorkflowDef({
      name: "with-inputs",
      inputs: {
        topic: { type: "string" },
      },
      steps: {
        only: {
          bot: "helper",
          prompt: "Research {{topic}}",
        },
      },
    });
    writeWorkflow(workflowsDir, "with-inputs", def);

    const deps = makeDeps({
      mechaDir,
      pm: {
        getPortAndToken: (() => ({ port: 7700, token: "test-token" })) as never,
      },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        response: "Done!",
        sessionId: "sess-1",
        durationMs: 100,
        costUsd: 0.01,
      }),
    })) as unknown as typeof fetch;

    try {
      const program = createProgram(deps);
      program.exitOverride();

      await program.parseAsync([
        "node", "mecha", "workflow", "run", "with-inputs",
        "--input", "topic=AI safety",
      ]);
      expect(deps.formatter.info).toHaveBeenCalledWith(
        expect.stringContaining("Started run:"),
      );

      // Verify inputs were stored
      const runsDir = join(workflowsDir, "runs", "with-inputs");
      const runFiles = require("node:fs").readdirSync(runsDir).filter((f: string) => f.endsWith(".json"));
      const runState = JSON.parse(readFileSync(join(runsDir, runFiles[0]!), "utf-8")) as RunState;
      expect(runState.inputs).toEqual(expect.objectContaining({ topic: "AI safety" }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("runs in dry-run mode without making real API calls", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    const workflowsDir = join(mechaDir, "workflows");
    const def = makeWorkflowDef({
      name: "dry-test",
      steps: {
        only: {
          bot: "helper",
          prompt: "Do the thing",
        },
      },
    });
    writeWorkflow(workflowsDir, "dry-test", def);

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    // Intercept fetch to detect real calls
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      return Promise.resolve(new Response());
    }) as unknown as typeof fetch;

    try {
      await program.parseAsync([
        "node", "mecha", "workflow", "run", "dry-test", "--dry-run",
      ]);

      // No real fetch calls made
      expect(fetchCalled).toBe(false);

      // Output includes [DRY RUN] prefix
      expect(deps.formatter.info).toHaveBeenCalledWith(
        expect.stringContaining("[DRY RUN]"),
      );
      expect(deps.formatter.info).toHaveBeenCalledWith(
        expect.stringContaining("Started run:"),
      );
      expect(deps.formatter.info).toHaveBeenCalledWith(
        expect.stringContaining("done"),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("dry-run produces zero cost", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    const workflowsDir = join(mechaDir, "workflows");
    const def = makeWorkflowDef({
      name: "dry-cost",
      steps: {
        step1: { bot: "a", prompt: "Do A" },
        step2: { bot: "b", prompt: "Do B", depends: ["step1"] },
      },
    });
    writeWorkflow(workflowsDir, "dry-cost", def);

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync([
      "node", "mecha", "workflow", "run", "dry-cost", "--dry-run",
    ]);

    // Should NOT print "Total cost:" since costUsd is 0
    const infoCalls = (deps.formatter.info as ReturnType<typeof import("vitest").vi.fn>).mock.calls;
    const costCall = infoCalls.find((c: unknown[]) => String(c[0]).includes("Total cost:"));
    expect(costCall).toBeUndefined();
  });
});

describe("workflow approve", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("shows error when run not found", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    mkdirSync(mechaDir, { recursive: true });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "approve", "test-wf", "run-123"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
    );
  });

  it("approves a waiting gate", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    const workflowsDir = join(mechaDir, "workflows");
    const runId = "run-2026-01-01-gate01";

    const def = makeWorkflowDef({
      name: "gated",
      steps: {
        review: {
          bot: "reviewer",
          prompt: "Review this",
          gate: "human",
        },
      },
    });

    const run = makeRunState({
      runId,
      workflow: "gated",
      status: "waiting",
      steps: {
        review: {
          status: "waiting",
          stepRunId: `${runId}:review:xyz`,
          attempts: 0,
        },
      },
      completedAt: undefined,
    });

    const runsDir = join(workflowsDir, "runs", "gated");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, `${runId}.json`), JSON.stringify(run, null, 2));
    writeFileSync(join(runsDir, `${runId}.yaml`), JSON.stringify(def, null, 2));

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "approve", "gated", runId]);
    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Approved gate"),
    );

    // Verify state was updated
    const updatedRaw = readFileSync(join(runsDir, `${runId}.json`), "utf-8");
    const updated = JSON.parse(updatedRaw) as RunState;
    expect(updated.steps.review!.status).toBe("pending");
    expect(updated.steps.review!.gateApproved).toBe(true);
  });

  it("warns when no steps waiting", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    const workflowsDir = join(mechaDir, "workflows");
    const runId = "run-2026-01-01-nogates";
    const run = makeRunState({ runId });
    writeRunState(workflowsDir, "test-workflow", run);

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "approve", "test-workflow", runId]);
    expect(deps.formatter.warn).toHaveBeenCalledWith("No steps waiting for approval");
  });
});

describe("workflow cancel", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("shows error when run not found", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    mkdirSync(mechaDir, { recursive: true });

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "cancel", "test-wf", "run-123"]);
    expect(deps.formatter.error).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
    );
  });

  it("cancels a running run", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    const workflowsDir = join(mechaDir, "workflows");
    const runId = "run-2026-01-01-cancel";

    const run = makeRunState({
      runId,
      status: "running",
      completedAt: undefined,
    });
    writeRunState(workflowsDir, "test-workflow", run);

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "cancel", "test-workflow", runId]);
    expect(deps.formatter.success).toHaveBeenCalledWith(
      expect.stringContaining("Cancelled"),
    );

    // Verify state was updated
    const updatedRaw = readFileSync(
      join(workflowsDir, "runs", "test-workflow", `${runId}.json`),
      "utf-8",
    );
    const updated = JSON.parse(updatedRaw) as RunState;
    expect(updated.status).toBe("cancelled");
  });

  it("warns when run is already terminal", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mecha-wf-"));
    const mechaDir = join(tempDir, ".mecha");
    const workflowsDir = join(mechaDir, "workflows");
    const runId = "run-2026-01-01-done";
    const run = makeRunState({ runId, status: "done" });
    writeRunState(workflowsDir, "test-workflow", run);

    const deps = makeDeps({ mechaDir });
    const program = createProgram(deps);
    program.exitOverride();

    await program.parseAsync(["node", "mecha", "workflow", "cancel", "test-workflow", runId]);
    expect(deps.formatter.warn).toHaveBeenCalledWith(
      expect.stringContaining("already done"),
    );
  });
});
