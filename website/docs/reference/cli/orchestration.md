---
title: Orchestration Commands
description: CLI reference for task, workflow, bus, team, meta, alert, metrics, secret, company, and trace commands
---

# Orchestration Commands

[[toc]]

Commands for the v4 orchestration layer: task delegation, workflow execution, message bus, team deployment, meta-agent, observability, secrets, and company configuration.

## Task

All task commands live under `mecha task`. Tasks are the unit of work delegation between bots — one bot (or the admin) creates a task targeting another bot, which executes it asynchronously.

### `mecha task create`

Create a task for a bot to execute.

```bash
mecha task create <target> <message>
```

| Argument | Description |
|----------|-------------|
| `<target>` | Bot name to run the task |
| `<message>` | Task message/instruction |

Creates a task on the agent server targeting the specified bot. The task is dispatched to the bot's runtime process asynchronously.

```bash
mecha task create researcher "Summarize the README in this project"
mecha task create coder "Fix the failing test in src/utils.ts"
```

### `mecha task list`

List tasks.

```bash
mecha task list [options]
```

Alias: `mecha task ls`

| Option | Description | Default |
|--------|-------------|---------|
| `--target <bot>` | Filter by target bot | |
| `--status <status>` | Filter by status (`pending`, `working`, `completed`, `failed`, `cancelled`) | |

Displays a table with task ID, target bot, status, message (truncated to 40 characters), and last updated timestamp.

```bash
mecha task list
mecha task ls --target researcher
mecha task list --status completed
mecha task ls --target coder --status failed
```

### `mecha task show`

Show task details.

```bash
mecha task show <id>
```

| Argument | Description |
|----------|-------------|
| `<id>` | Task ID |

Displays all task fields: ID, target, status, message, result (if completed), error (if failed), session ID, duration, cost, and timestamps.

```bash
mecha task show task-a1b2c3d4e5f6g7h8
```

### `mecha task cancel`

Cancel a running task.

```bash
mecha task cancel <id>
```

| Argument | Description |
|----------|-------------|
| `<id>` | Task ID |

Cancels a task that is in `pending` or `working` status. Tasks in terminal states (`completed`, `failed`, `cancelled`) cannot be cancelled.

```bash
mecha task cancel task-a1b2c3d4e5f6g7h8
```

## Workflow

All workflow commands live under `mecha workflow`. Workflow definitions are YAML files stored in `~/.mecha/workflows/`.

### `mecha workflow list`

List all workflow definitions.

```bash
mecha workflow list
```

Alias: `mecha workflow ls`

Scans the `~/.mecha/workflows/` directory for `.yaml` files and displays their names.

```bash
mecha workflow ls
```

### `mecha workflow show`

Show a workflow definition with its step DAG.

```bash
mecha workflow show <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Workflow name |

Displays the workflow's name, description, budget, inputs (with types and defaults), and step graph including dependencies and gates.

```bash
mecha workflow show deploy-pipeline
```

### `mecha workflow run`

Start a new workflow run.

```bash
mecha workflow run <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | Workflow name |

| Option | Description | Default |
|--------|-------------|---------|
| `--input <key=value...>` | Input values (repeatable) | |
| `--dry-run` | Execute with mock bot responses (no real API calls) | |

Loads the workflow definition from `~/.mecha/workflows/<name>.yaml`, starts a run, and executes steps sequentially until the workflow completes, fails, or reaches a human gate. Automatically generates an observe trace for completed or failed runs.

```bash
mecha workflow run deploy-pipeline --input repo=my-app --input branch=main
mecha workflow run code-review --dry-run
mecha workflow run summarize --input url=https://example.com
```

### `mecha workflow runs`

List run history for a workflow.

```bash
mecha workflow runs <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Workflow name |

Displays a table of all runs sorted by start time (newest first), showing run ID, status, start time, and total cost.

```bash
mecha workflow runs deploy-pipeline
```

### `mecha workflow run-detail`

Show detailed status for a workflow run.

```bash
mecha workflow run-detail <run-id>
```

| Argument | Description |
|----------|-------------|
| `<run-id>` | Run ID |

Searches across all workflow run directories to find the run, then displays run metadata and a per-step table with status, cost, duration, and error information.

```bash
mecha workflow run-detail abc123-def456
```

### `mecha workflow rate`

Record a human quality score for a workflow run.

```bash
mecha workflow rate <run-id> <score>
```

| Argument | Description |
|----------|-------------|
| `<run-id>` | Run ID |
| `<score>` | Quality score (integer, 1-5) |

Stores the score in the observe score store for use in metrics and tuning analysis.

```bash
mecha workflow rate abc123-def456 4
```

### `mecha workflow approve`

Approve a human gate in a workflow run.

```bash
mecha workflow approve <workflow> <run-id>
```

| Argument | Description |
|----------|-------------|
| `<workflow>` | Workflow name |
| `<run-id>` | Run ID |

Finds all steps in the "waiting" state and approves their gates so execution can continue. If no steps are waiting, a warning is shown.

```bash
mecha workflow approve deploy-pipeline abc123-def456
```

### `mecha workflow cancel`

Cancel an in-progress workflow run.

```bash
mecha workflow cancel <workflow> <run-id>
```

| Argument | Description |
|----------|-------------|
| `<workflow>` | Workflow name |
| `<run-id>` | Run ID |

Cancels the run if it is still active. If the run is already in a terminal state (`done`, `failed`, `cancelled`, `compensated`), a warning is shown instead.

```bash
mecha workflow cancel deploy-pipeline abc123-def456
```

## Bus

All bus commands live under `mecha bus`. The message bus provides pub/sub topics and durable queues, backed by the filesystem in `~/.mecha/bus/`.

### `mecha bus topic create`

Create a new topic.

```bash
mecha bus topic create <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Topic name |

```bash
mecha bus topic create events
mecha bus topic create deploy-notifications
```

### `mecha bus topic list`

List all topics.

```bash
mecha bus topic list
```

Alias: `mecha bus topic ls`

Displays a table of all topic names.

```bash
mecha bus topic ls
```

### `mecha bus topic publish`

Publish a message to a topic.

```bash
mecha bus topic publish <topic> <message>
```

| Argument | Description |
|----------|-------------|
| `<topic>` | Topic name |
| `<message>` | Message payload (string or JSON) |

If `<message>` is valid JSON, it is parsed and stored as a structured object. Otherwise it is stored as a plain string. The sender is recorded as `"cli"`.

```bash
mecha bus topic publish events "deployment started"
mecha bus topic publish events '{"action":"deploy","repo":"my-app"}'
```

### `mecha bus topic tail`

Show the last N messages from a topic.

```bash
mecha bus topic tail <topic> [options]
```

| Argument | Description |
|----------|-------------|
| `<topic>` | Topic name |

| Option | Description | Default |
|--------|-------------|---------|
| `-n, --lines <count>` | Number of messages to show | `10` |

Displays a table with message ID, timestamp, sender, and payload (truncated to 50 characters).

```bash
mecha bus topic tail events
mecha bus topic tail events -n 25
```

### `mecha bus queue create`

Create a new durable queue.

```bash
mecha bus queue create <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | Queue name |

| Option | Description | Default |
|--------|-------------|---------|
| `--max-retries <count>` | Maximum retry attempts | `3` |

```bash
mecha bus queue create tasks
mecha bus queue create work-items --max-retries 5
```

### `mecha bus queue list`

List all queues.

```bash
mecha bus queue list
```

Alias: `mecha bus queue ls`

Displays a table of all queue names.

```bash
mecha bus queue ls
```

### `mecha bus queue inspect`

Show pending, inflight, and dead-letter counts for a queue.

```bash
mecha bus queue inspect <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Queue name |

Displays a metric/count table with `pending`, `inflight`, and `dead` rows.

```bash
mecha bus queue inspect tasks
```

### `mecha bus queue drain`

Move all pending messages to dead letter.

```bash
mecha bus queue drain <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Queue name |

Drains all pending messages into the dead-letter store. Reports the number of messages moved.

```bash
mecha bus queue drain tasks
```

## Team

All team commands live under `mecha team`. Teams are groups of bots deployed from a JSON definition file, with ACL rules automatically configured.

### `mecha team deploy`

Deploy a team from a JSON definition file.

```bash
mecha team deploy <file>
```

| Argument | Description |
|----------|-------------|
| `<file>` | Path to team definition JSON file |

Reads the definition, spawns each bot with the specified configuration, and sets up ACL rules between them. Reports the number of bots deployed, ACL rules created, and files scaffolded.

```bash
mecha team deploy ./teams/research-team.json
mecha team deploy ~/teams/deploy-squad.json
```

### `mecha team list`

List deployed teams.

```bash
mecha team list
```

Displays a table with team name, bot names, home directory, workspace, and deployment timestamp.

```bash
mecha team list
```

### `mecha team status`

Show status of a deployed team.

```bash
mecha team status <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Team name |

Displays a field/value table with team name, bots, home, workspace, and deployment timestamp.

```bash
mecha team status research-team
```

### `mecha team sync`

Sync team workspace to registered nodes.

```bash
mecha team sync <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | Team name to sync |

| Option | Description | Default |
|--------|-------------|---------|
| `--node <name>` | Sync to a specific node only | all nodes |

Creates a sync bundle from the team's workspace and distributes it to registered nodes.

::: warning
Server-side sync is not yet implemented. The command currently outputs a manual `scp` command as a fallback.
:::

```bash
mecha team sync research-team
mecha team sync research-team --node gpu-server
```

### `mecha team teardown`

Stop and remove all bots in a team, then unregister it.

```bash
mecha team teardown <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | Team name |

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Force kill bots instead of graceful stop | `false` |

Stops each bot in the team (gracefully by default, or with `--force` for SIGKILL), then unregisters the team from the team registry.

```bash
mecha team teardown research-team
mecha team teardown research-team --force
```

## Meta

All meta commands live under `mecha meta`. The meta-agent is a special bot that provides fleet-level oversight, tuning recommendations, and report generation.

### `mecha meta status`

Show meta-agent status and recent activity.

```bash
mecha meta status
```

Displays whether the meta-agent bot is running (and its port), a summary of workflow runs (total, active), and the status of all registered remote nodes (online/offline with latency).

```bash
mecha meta status
```

### `mecha meta goal`

Submit a high-level goal to the meta-agent.

```bash
mecha meta goal <goal>
```

| Argument | Description |
|----------|-------------|
| `<goal>` | The goal to achieve |

Sends the goal as a chat message to the `meta-agent` bot. The meta-agent must be running; if it is not, the command shows a hint to spawn it first.

```bash
mecha meta goal "Review all bots and optimize their system prompts"
mecha meta goal "Generate a cost report for last week"
```

### `mecha meta tune`

Analyze bot quality and show tuning recommendations.

```bash
mecha meta tune [bot]
```

| Argument | Description |
|----------|-------------|
| `[bot]` | Specific bot to analyze (omit for all) |

Reads quality scores from the observe store and produces a per-bot analysis including trend direction, average score, recent average, total number of scores, and a tuning recommendation.

```bash
mecha meta tune
mecha meta tune researcher
```

### `mecha meta report`

Generate a summary report of company activity.

```bash
mecha meta report [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--days <days>` | Number of days to cover | `7` |

Aggregates workflow traces within the time window and reports per-workflow run count, success rate, average cost, and quality score (if available). Ends with a total summary.

```bash
mecha meta report
mecha meta report --days 30
```

### `mecha meta experiment`

Create an A/B test experiment definition.

```bash
mecha meta experiment <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | Experiment name |

| Option | Description | Default |
|--------|-------------|---------|
| `--config-a <file>` | Config file for variant A | **(required)** |
| `--config-b <file>` | Config file for variant B | **(required)** |
| `--workflow <name>` | Workflow to test | **(required)** |
| `--runs <n>` | Number of runs per variant | `5` |

Creates an experiment definition and stores it at `~/.mecha/observe/experiments/<name>.json`.

```bash
mecha meta experiment prompt-test \
  --config-a ./config-v1.json \
  --config-b ./config-v2.json \
  --workflow code-review \
  --runs 10
```

## Alert

All alert commands live under `mecha alert`. Alerts are rule-based monitors that fire when a metric crosses a threshold.

### `mecha alert add`

Add an alert rule.

```bash
mecha alert add <id> [options]
```

| Argument | Description |
|----------|-------------|
| `<id>` | Unique rule ID |

| Option | Description | Default |
|--------|-------------|---------|
| `--metric <m>` | Metric name to monitor | **(required)** |
| `--threshold <n>` | Threshold value | **(required)** |
| `--comparison <op>` | Comparison operator: `gt`, `lt`, `gte`, `lte` | **(required)** |
| `--message <msg>` | Alert message | **(required)** |

```bash
mecha alert add high-cost --metric avgCostUsd --threshold 2.0 --comparison gt --message "Average cost exceeded $2"
mecha alert add low-success --metric successRate --threshold 0.8 --comparison lt --message "Success rate below 80%"
```

### `mecha alert list`

Show fired alerts or configured alert rules.

```bash
mecha alert list [options]
```

Alias: `mecha alert ls`

| Option | Description | Default |
|--------|-------------|---------|
| `--rules` | Show alert rules instead of fired alerts | |

Without `--rules`, displays a table of fired alerts (rule ID, value, message, fired timestamp). With `--rules`, displays the configured rules (ID, metric, comparison, threshold, message).

```bash
mecha alert list
mecha alert ls --rules
```

### `mecha alert remove`

Remove an alert rule.

```bash
mecha alert remove <id>
```

Alias: `mecha alert rm`

| Argument | Description |
|----------|-------------|
| `<id>` | Rule ID to remove |

```bash
mecha alert remove high-cost
mecha alert rm low-success
```

## Metrics

All metrics commands live under `mecha metrics`. Metrics are computed from observe traces stored in `~/.mecha/observe/traces/`.

### `mecha metrics bot`

Show per-bot performance metrics.

```bash
mecha metrics bot <name> [options]
```

| Argument | Description |
|----------|-------------|
| `<name>` | Bot name |

| Option | Description | Default |
|--------|-------------|---------|
| `--days <n>` | Number of days to include | `7` |

Displays the bot's step count, success rate, average cost, average duration, average quality score (if available), and revision rate (if available).

```bash
mecha metrics bot researcher
mecha metrics bot coder --days 30
```

### `mecha metrics workflow`

Show per-workflow metrics.

```bash
mecha metrics workflow <name>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Workflow name |

Displays run count, success rate, average cost, average duration, and average quality score (if available) across all traces for the given workflow.

```bash
mecha metrics workflow deploy-pipeline
mecha metrics workflow code-review
```

## Secret

All secret commands live under `mecha secret`. Secrets are stored in the gateway credential store at `~/.mecha/gateway/` and access is controlled per-bot.

### `mecha secret set`

Store a secret.

```bash
mecha secret set <name> <value>
```

| Argument | Description |
|----------|-------------|
| `<name>` | Secret name |
| `<value>` | Secret value |

```bash
mecha secret set GITHUB_TOKEN ghp_xxxxxxxxxxxx
mecha secret set OPENAI_KEY sk-xxxxxxxxxxxx
```

### `mecha secret list`

List stored secrets.

```bash
mecha secret list
```

Displays a table of secret names (values are never shown).

```bash
mecha secret list
```

### `mecha secret grant`

Grant a bot access to a secret.

```bash
mecha secret grant <bot> <secret>
```

| Argument | Description |
|----------|-------------|
| `<bot>` | Bot name |
| `<secret>` | Secret name |

```bash
mecha secret grant researcher GITHUB_TOKEN
mecha secret grant coder OPENAI_KEY
```

### `mecha secret revoke`

Revoke a bot's access to a secret.

```bash
mecha secret revoke <bot> <secret>
```

| Argument | Description |
|----------|-------------|
| `<bot>` | Bot name |
| `<secret>` | Secret name |

```bash
mecha secret revoke researcher GITHUB_TOKEN
```

## Company

All company commands live under `mecha company`. The company config is a git-managed directory at `~/.mecha/_company/` that holds shared configuration distributed across nodes.

### `mecha company init`

Initialize the company config repository.

```bash
mecha company init
```

Creates `~/.mecha/_company/` and runs `git init` inside it. If the repository is already initialized, the command is a no-op.

```bash
mecha company init
```

### `mecha company sync`

Sync company config to registered nodes.

```bash
mecha company sync [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--node <name>` | Sync to a specific node only | all nodes |

Creates a sync bundle from the company directory and distributes it to registered nodes.

::: warning
Server-side sync is not yet implemented. The command currently outputs a manual `scp` command as a fallback.
:::

```bash
mecha company sync
mecha company sync --node gpu-server
```

## Trace

All trace commands live under `mecha trace`. Traces are structured records of workflow runs stored in `~/.mecha/observe/traces/`.

### `mecha trace list`

List recent traces, optionally filtered by workflow.

```bash
mecha trace list [workflow]
```

Alias: `mecha trace ls`

| Argument | Description |
|----------|-------------|
| `[workflow]` | Workflow name (omit to list all workflows) |

Without a workflow argument, lists all traces across all workflows sorted by start time (newest first), including workflow name, run ID, status, start time, and cost. With a workflow argument, lists only traces for that workflow.

```bash
mecha trace list
mecha trace ls deploy-pipeline
```

### `mecha trace show`

Display a structured trace for a workflow run.

```bash
mecha trace show <workflow> <run-id>
```

| Argument | Description |
|----------|-------------|
| `<workflow>` | Workflow name |
| `<run-id>` | Run ID |

Displays trace metadata (ID, workflow, status, timestamps, cost, quality score) and a per-step table with step name, bot, status, duration, and cost.

```bash
mecha trace show deploy-pipeline abc123-def456
```
