---
title: Scheduling
description: Built-in cron-like scheduler for running agent tasks on a recurring basis.
---

# Scheduling

Mecha includes a built-in scheduler for running agent tasks on a recurring basis — cron-like automation without leaving the Mecha ecosystem.

## Adding a Schedule

```bash
# Run every hour
mecha schedule add researcher --id check-papers --every 1h --prompt "Check for new papers"

# Run every 30 minutes
mecha schedule add coder --id run-tests --every 30m --prompt "Run the test suite"
```

The `--every` accepts human-readable intervals (`30s`, `5m`, `1h`). The `--prompt` is sent to the agent on each run. The `--id` is a unique identifier for the schedule.

## Managing Schedules

```bash
# List all schedules for a bot
mecha schedule list <bot>

# Pause a schedule on a bot
mecha schedule pause <bot> <schedule-id>

# Pause all schedules on a bot
mecha schedule pause <bot>

# Resume a paused schedule
mecha schedule resume <bot> <schedule-id>

# Run immediately (outside schedule)
mecha schedule run <bot> <schedule-id>

# Remove a schedule
mecha schedule remove <bot> <schedule-id>
```

## Run History

```bash
# View past runs
mecha schedule history <bot> <schedule-id>
```

Shows timestamps, outcomes (success/failure), and response summaries for each execution.

## How It Works

The scheduler runs inside the bot runtime. When a schedule triggers:

1. The scheduler sends the configured message as a chat query
2. The agent processes the query using its workspace and tools
3. The result is recorded in the schedule history
4. The next run is scheduled based on the interval

Schedules persist across bot restarts -- they are stored in the bot's configuration and state files on disk.

### Safety Mechanisms

The scheduler includes several safeguards to prevent runaway execution:

- **Daily budget** -- A configurable `maxRunsPerDay` limit (default: 50) is enforced across all schedules for the bot. Runs that exceed the budget are recorded with outcome `"skipped"`.
- **Concurrency guard** -- Only one schedule can execute at a time per bot. If a run is attempted while another is active, it is skipped.
- **Auto-pause on consecutive errors** -- After 5 consecutive failures, the schedule is automatically paused to prevent repeated failures.
- **Chained setTimeout** -- The scheduler uses chained `setTimeout` calls (not `setInterval`) to prevent overlapping runs when a single execution takes longer than the interval.
- **Today counter reset** -- The `runsToday` counter automatically resets when the date changes (compared via ISO date string).

## Core Types (`@mecha/core`)

The schedule type definitions and validation schemas live in `@mecha/core` and are shared between the CLI, runtime, and dashboard.

### `parseInterval(input): number | undefined`

Parse a human-readable interval string to milliseconds. Returns `undefined` for invalid input.

```ts
import { parseInterval } from "@mecha/core";

parseInterval("30s");  // 30000
parseInterval("5m");   // 300000
parseInterval("1h");   // 3600000
parseInterval("2d");   // undefined (unsupported unit)
parseInterval("5s");   // undefined (below 10s minimum)
```

Accepted units: `s` (seconds), `m` (minutes), `h` (hours). Range: 10 seconds to 24 hours.

### `ScheduleEntry`

```ts
interface ScheduleEntry {
  id: string;          // Unique ID (lowercase alphanumeric with hyphens)
  trigger: {
    type: "interval";
    every: string;     // Human-readable interval (e.g., "5m")
    intervalMs: number; // Parsed interval in milliseconds
  };
  prompt: string;      // Message sent to the agent on each run
  paused?: boolean;    // Whether the schedule is paused
}
```

Validated by `ScheduleEntrySchema` (Zod). The `id` follows the same naming rules as bot names.

### `ScheduleRunResult`

```ts
interface ScheduleRunResult {
  scheduleId: string;
  startedAt: string;    // ISO timestamp
  completedAt: string;  // ISO timestamp
  durationMs: number;
  outcome: "success" | "error" | "skipped";
  error?: string;       // Present when outcome is "error"
}
```

Validated by `ScheduleRunResultSchema` (Zod).

### `ScheduleConfig`

```ts
interface ScheduleConfig {
  schedules: ScheduleEntry[];
  maxRunsPerDay?: number;   // Default: 50
  maxConcurrent?: 1;        // Currently only 1 is supported
}
```

Stored in the bot's `schedule-config.json`. Validated by `ScheduleConfigSchema` (Zod).

### `ScheduleState`

```ts
interface ScheduleState {
  nextRunAt?: string;          // ISO timestamp of next scheduled run
  lastRunAt?: string;          // ISO timestamp of last run
  runCount: number;            // Total runs executed
  todayDate: string;           // ISO date string for daily counter reset
  runsToday: number;           // Runs executed today
  consecutiveErrors?: number;  // Error counter for auto-pause
}
```

Per-schedule runtime state stored in `schedule-state.json`. Validated by `ScheduleStateSchema` (Zod).

### `ScheduleAddInput`

```ts
// Zod schema and inferred type
const ScheduleAddInput = z.object({
  id: z.string().min(1).max(32).regex(/^[a-z0-9-]+$/),
  every: z.string().min(1),
  prompt: z.string().min(1),
});
type ScheduleAddInput = z.infer<typeof ScheduleAddInput>;
```

Input schema for adding a schedule via CLI or HTTP API. The `every` field is validated by `parseInterval()` at the engine level.

### `SCHEDULE_DEFAULTS`

```ts
const SCHEDULE_DEFAULTS = {
  MAX_RUNS_PER_DAY: 50,
  MAX_CONCURRENT: 1,
  MAX_CONSECUTIVE_ERRORS: 5,
  MAX_SCHEDULES_PER_BOT: 20,
  MAX_HISTORY_ENTRIES: 1000,
  RUN_TIMEOUT_MS: 600_000,  // 10 minutes
} as const;
```

Default limits for the schedule engine.

### Schedule Error Classes

| Error | Code | HTTP | Description |
|-------|------|------|-------------|
| `ScheduleNotFoundError` | `SCHEDULE_NOT_FOUND` | 404 | No schedule with the given ID exists |
| `DuplicateScheduleError` | `DUPLICATE_SCHEDULE` | 409 | A schedule with this ID already exists |
| `InvalidIntervalError` | `INVALID_INTERVAL` | 400 | The interval string is invalid (bad format, out of range) |
| `ScheduleLimitError` | `SCHEDULE_LIMIT` | 409 | Maximum schedules per bot reached |

See [Error Reference](/reference/errors) for the complete error catalog.

## API Reference (`@mecha/runtime`)

### `createScheduleEngine(opts): ScheduleEngine`

Creates a schedule engine that manages recurring prompt executions for a single bot.

```ts
import { createScheduleEngine } from "@mecha/runtime";

const engine = createScheduleEngine({
  botDir: "/Users/you/.mecha/researcher",
  botName: "researcher",
  chatFn: async (prompt) => {
    const start = Date.now();
    // Execute the prompt against the Claude Agent SDK
    return { durationMs: Date.now() - start };
  },
});

engine.start();
```

**`CreateScheduleEngineOpts`**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `botDir` | `string` | Yes | Path to the bot root directory (config and state are stored here) |
| `botName` | `string` | Yes | bot name (used in log messages) |
| `chatFn` | `ChatFn` | Yes | Async function that executes a prompt and returns the result |
| `now` | `() => number` | No | Clock function (defaults to `Date.now`, override for testing) |
| `log` | `ScheduleLog` | No | Logging function (defaults to no-op) |

### `ChatFn`

```ts
type ChatFn = (prompt: string) => Promise<{ durationMs: number; error?: string }>;
```

The function called on each scheduled run. Return `{ durationMs }` on success, or include an `error` string to record the run as failed.

### `ScheduleEngine`

The engine returned by `createScheduleEngine`. All methods read/write configuration from the filesystem (no in-memory-only state).

| Method | Description |
|--------|-------------|
| `start()` | Load schedules from disk and arm timers for all unpaused schedules |
| `stop()` | Clear all timers and stop executing schedules |
| `addSchedule(entry)` | Add a new schedule (validates interval, throws `DuplicateScheduleError` or `InvalidIntervalError`) |
| `removeSchedule(id)` | Remove a schedule and its on-disk data (throws `ScheduleNotFoundError`) |
| `pauseSchedule(id?)` | Pause one schedule by ID, or all schedules if `id` is omitted |
| `resumeSchedule(id?)` | Resume one schedule by ID, or all schedules if `id` is omitted |
| `listSchedules()` | Return all schedule entries from the config file |
| `getHistory(id, limit?)` | Return run history for a schedule (throws `ScheduleNotFoundError`) |
| `triggerNow(id)` | Execute a schedule immediately, bypassing the timer (throws `ScheduleNotFoundError`) |

### `executeRun(entry, deps): Promise<ScheduleRunResult>`

Low-level function that executes a single schedule run. Used internally by the engine and available for direct invocation.

```ts
import { executeRun } from "@mecha/runtime";
```

The function performs budget checking, concurrency guarding, state updates, history recording, and auto-pause logic.

**`RunDeps`**

| Field | Type | Description |
|-------|------|-------------|
| `botDir` | `string` | bot root directory |
| `chatFn` | `(prompt: string) => Promise<{ durationMs: number; error?: string }>` | Prompt execution function |
| `now` | `() => number` | Clock function |
| `getActiveRun` | `() => string \| undefined` | Returns the ID of the currently running schedule (if any) |
| `setActiveRun` | `(id: string \| undefined) => void` | Sets or clears the active run ID |
| `log` | `ScheduleLog` | Logging function |

**`ScheduleLog`**

```ts
type ScheduleLog = (
  level: "info" | "warn" | "error",
  msg: string,
  data?: Record<string, unknown>
) => void;
```

### Run Outcomes

Each run produces a `ScheduleRunResult` with one of three outcomes:

| Outcome | When |
|---------|------|
| `"success"` | `chatFn` returned without an `error` field |
| `"error"` | `chatFn` returned with an `error` field, or threw an exception |
| `"skipped"` | Daily budget exceeded, or another schedule is already running |
