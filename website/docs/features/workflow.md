# Workflow Engine

The workflow engine executes multi-step DAGs (directed acyclic graphs) where the output of one bot feeds into the next. Steps can run in parallel, branch conditionally, pause for human approval, and roll back on failure.

## Core Concepts

### Workflow

A named DAG of steps defined in YAML. Each step specifies which bot runs it, what prompt to send, and what dependencies it has.

### Step

A unit of work: bot + prompt template + dependencies + optional output schema. Steps execute when all their dependencies are satisfied.

### Gate

A pause point where a human must approve before the workflow continues. Used for deployments, publications, or high-cost operations.

### Compensation

If a downstream step fails, the engine walks backward through completed steps running rollback prompts (saga pattern).

## Example

```yaml
name: content-pipeline
steps:
  research:
    bot: researcher
    prompt: "Find trending topics in AI"
    output: topics

  draft:
    bot: writer
    prompt: "Write about: {{research.topics}}"
    depends: [research]
    output: article

  review:
    bot: editor
    prompt: "Review: {{draft.article}}"
    depends: [draft]
    gate: human
```

## Key Features

- **Definition snapshot**: Workflow definition is frozen at run start — in-progress runs aren't affected by definition changes.
- **Step idempotency**: Each step has a unique `stepRunId`. Re-execution is skipped if a result already exists (safe daemon restart).
- **Template rendering**: Prompts use `{{step.output.field}}` syntax with dot notation and array indexing.
- **Conditional steps**: Steps can be skipped based on previous outputs (`condition: "!review.approved"`).
- **Parallel execution**: Steps with the same dependencies run concurrently (fan-out/fan-in).
- **Compensation (saga rollback)**: Steps declare optional `compensate` prompts. On failure, completed steps are rolled back in reverse order.
- **Cycle detection**: The engine validates the DAG at creation time and rejects circular dependencies.
- **Cost tracking**: Per-step and per-run cost accumulation.

## Data Model

```
~/.mecha/workflows/
├── content-pipeline.yaml              # workflow definition
└── runs/
    └── content-pipeline/
        ├── run-2026-03-21-abc.json    # run state (step statuses + outputs)
        └── run-2026-03-21-abc.yaml    # snapshotted definition (immutable)
```

## CLI Usage

```bash
# List workflows
mecha workflow list
# Name           File
# -------------  ------------------
# test-pipeline  test-pipeline.yaml

# Show DAG
mecha workflow show test-pipeline
# Workflow: test-pipeline
# Steps:
#   research: bot=researcher
#   summarize: bot=writer -> depends: [research]

# Dry-run (no API calls, $0 cost)
mecha workflow run test-pipeline --dry-run
# [DRY RUN] Started run: run-2026-03-21-7df47ce8
# [DRY RUN]   Step "research": completed
# [DRY RUN]   Step "summarize": completed
# [DRY RUN] Run run-2026-03-21-7df47ce8: done

# Real execution
mecha workflow run test-pipeline
# Started run: run-2026-03-21-b2d92950
#   Step "research": completed
#   Step "summarize": completed
# Run run-2026-03-21-b2d92950: done
# Total cost: $0.0209

# Run history
mecha workflow runs test-pipeline
# Run ID                   Status  Started                   Cost
# -----------------------  ------  ------------------------  -------
# run-2026-03-21-b2d92950  done    2026-03-21T09:25:01.322Z  $0.0209

# Per-step detail
mecha workflow run-detail run-2026-03-21-b2d92950
# Steps:
# Step       Status     Cost     Duration
# ---------  ---------  -------  --------
# research   completed  $0.0106  6927ms
# summarize  completed  $0.0102  6628ms

# Approve a gate
mecha workflow approve test-pipeline run-2026-03-21-xxx

# Cancel a run
mecha workflow cancel test-pipeline run-2026-03-21-xxx
```

### MCP Tools (available to bots)

Bots can manage workflows via MCP: `workflow_list`, `workflow_run`, `workflow_status`.

## Package

`@mecha/workflow` — `packages/workflow/src/`

| Export | Description |
|--------|-------------|
| `createEngine(opts)` | Create a workflow engine for a definition |
| `renderTemplate(template, context)` | Render `{{expr}}` templates |
| `evaluateCondition(condition, context)` | Evaluate step conditions |
| `createDryRunExecutor(responses?)` | Mock executor for testing |
| `acquireLock(lockDir, resource)` | Workspace file lock |
