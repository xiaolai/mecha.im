package store

const schemaV1 = `
CREATE TABLE IF NOT EXISTS workers (
	name         TEXT PRIMARY KEY,
	definition   TEXT NOT NULL,
	state        TEXT NOT NULL DEFAULT 'offline',
	error_msg    TEXT NOT NULL DEFAULT '',
	container_id TEXT NOT NULL DEFAULT '',
	endpoint     TEXT NOT NULL DEFAULT '',
	started_at   INTEGER
);

CREATE TABLE IF NOT EXISTS tasks (
	id             TEXT PRIMARY KEY,
	worker_name    TEXT NOT NULL,
	prompt         TEXT NOT NULL,
	state          TEXT NOT NULL DEFAULT 'pending',
	result         TEXT NOT NULL DEFAULT '',
	error_msg      TEXT NOT NULL DEFAULT '',
	created_at     INTEGER NOT NULL,
	updated_at     INTEGER NOT NULL,
	dispatched_at  INTEGER,
	completed_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
CREATE INDEX IF NOT EXISTS idx_tasks_worker ON tasks(worker_name);
`

const schemaV2 = `
ALTER TABLE tasks ADD COLUMN event_id TEXT;
ALTER TABLE tasks ADD COLUMN context TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS events (
	id           TEXT PRIMARY KEY,
	delivery_id  TEXT NOT NULL DEFAULT '',
	source       TEXT NOT NULL,
	type         TEXT NOT NULL,
	repo_owner   TEXT NOT NULL DEFAULT '',
	repo_name    TEXT NOT NULL DEFAULT '',
	ref          TEXT NOT NULL DEFAULT '',
	number       INTEGER NOT NULL DEFAULT 0,
	sender       TEXT NOT NULL DEFAULT '',
	payload      TEXT NOT NULL DEFAULT '{}',
	raw          TEXT NOT NULL DEFAULT '',
	state        TEXT NOT NULL DEFAULT 'received',
	worker_name  TEXT NOT NULL DEFAULT '',
	task_id      TEXT NOT NULL DEFAULT '',
	created_at   INTEGER NOT NULL,
	updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_state ON events(state);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source, type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_delivery ON events(delivery_id) WHERE delivery_id != '';
`

// schemaV3 generalizes events: removes git-specific columns,
// adds actor/subject/dedup_key, renames payload→attrs.
const schemaV3 = `
CREATE TABLE IF NOT EXISTS events_v3 (
	id           TEXT PRIMARY KEY,
	delivery_id  TEXT NOT NULL DEFAULT '',
	dedup_key    TEXT NOT NULL DEFAULT '',
	source       TEXT NOT NULL,
	type         TEXT NOT NULL,
	actor        TEXT NOT NULL DEFAULT '',
	subject      TEXT NOT NULL DEFAULT '',
	attrs        TEXT NOT NULL DEFAULT '{}',
	raw          TEXT NOT NULL DEFAULT '',
	state        TEXT NOT NULL DEFAULT 'received',
	worker_name  TEXT NOT NULL DEFAULT '',
	task_id      TEXT NOT NULL DEFAULT '',
	created_at   INTEGER NOT NULL,
	updated_at   INTEGER NOT NULL
);

INSERT INTO events_v3 (id, delivery_id, dedup_key, source, type,
	actor, subject, attrs, raw, state, worker_name, task_id, created_at, updated_at)
SELECT id, delivery_id, '', source, type,
	sender, CASE WHEN repo_owner != '' THEN repo_owner || '/' || repo_name ELSE '' END,
	payload, raw, state, worker_name, task_id, created_at, updated_at
FROM events;

DROP TABLE events;
ALTER TABLE events_v3 RENAME TO events;

CREATE INDEX IF NOT EXISTS idx_events_state ON events(state);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source, type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_delivery ON events(delivery_id) WHERE delivery_id != '';
CREATE INDEX IF NOT EXISTS idx_events_dedup ON events(dedup_key) WHERE dedup_key != '';
`

// schemaV4 adds dedup_key to tasks for idempotent dispatch on crash recovery.
const schemaV4 = `
ALTER TABLE tasks ADD COLUMN dedup_key TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_dedup ON tasks(dedup_key) WHERE dedup_key != '';
`

// schemaV5 adds retry tracking to tasks and dedup enforcement index to events.
const schemaV5 = `
ALTER TABLE tasks ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 3;
ALTER TABLE tasks ADD COLUMN next_retry_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_tasks_retry ON tasks(state, next_retry_at) WHERE state = 'pending' AND next_retry_at IS NOT NULL;
`

// schemaV7 adds write-back retry tracking to events.
// write_back_attempts counts how many write-back attempts have been made.
// write_back_last_err stores the most recent write-back error for diagnosis.
const schemaV7 = `
ALTER TABLE events ADD COLUMN write_back_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN write_back_last_err TEXT NOT NULL DEFAULT ''
`

// schemaV6 adds the structured log table.
const schemaV6 = `
CREATE TABLE IF NOT EXISTS logs (
	id       INTEGER PRIMARY KEY AUTOINCREMENT,
	trace_id TEXT NOT NULL DEFAULT '',
	ts       INTEGER NOT NULL,
	action   TEXT NOT NULL,
	outcome  TEXT NOT NULL DEFAULT 'ok',
	event_id TEXT NOT NULL DEFAULT '',
	task_id  TEXT NOT NULL DEFAULT '',
	worker   TEXT NOT NULL DEFAULT '',
	attempt  INTEGER NOT NULL DEFAULT 0,
	error    TEXT NOT NULL DEFAULT '',
	detail   TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_logs_trace ON logs(trace_id) WHERE trace_id != '';
CREATE INDEX IF NOT EXISTS idx_logs_event ON logs(event_id) WHERE event_id != '';
CREATE INDEX IF NOT EXISTS idx_logs_task ON logs(task_id) WHERE task_id != '';
CREATE INDEX IF NOT EXISTS idx_logs_action_ts ON logs(action, ts);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);
`
