import { defError } from "./errors-base.js";

// --- Schedule errors ---
/** Error thrown when a schedule ID does not exist. */
export const ScheduleNotFoundError = defError<[string]>(
  "ScheduleNotFoundError",
  { code: "SCHEDULE_NOT_FOUND", statusCode: 404, exitCode: 1 },
  (id) => `Schedule "${id}" not found`,
);

/** Error thrown when a schedule with the given ID already exists. */
export const DuplicateScheduleError = defError<[string]>(
  "DuplicateScheduleError",
  { code: "DUPLICATE_SCHEDULE", statusCode: 409, exitCode: 1 },
  (id) => `Schedule "${id}" already exists`,
);

/** Error thrown when a schedule interval is invalid. */
export const InvalidIntervalError = defError<[string]>(
  "InvalidIntervalError",
  { code: "INVALID_INTERVAL", statusCode: 400, exitCode: 1 },
  (interval) => `Invalid interval: "${interval}" (use format like "30s", "5m", "1h"; min 10s, max 24h)`,
);

/** Error thrown when the schedule limit is reached. */
/* v8 ignore start -- error factory message template */
export const ScheduleLimitError = defError<[number]>(
  "ScheduleLimitError",
  { code: "SCHEDULE_LIMIT", statusCode: 409, exitCode: 1 },
  (max) => `Maximum schedules per bot (${max}) reached`,
);
/* v8 ignore stop */

// --- CLI errors ---
/** Error thrown when another mecha CLI instance is already running. */
export const CliAlreadyRunningError = defError<[number]>(
  "CliAlreadyRunningError",
  { code: "CLI_ALREADY_RUNNING", statusCode: 409, exitCode: 1 },
  (pid) => `Another mecha CLI is already running (pid ${pid})`,
);
