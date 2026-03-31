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

const schemaV3 = `
ALTER TABLE workers ADD COLUMN tunnel_pid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workers ADD COLUMN tunnel_local_port INTEGER NOT NULL DEFAULT 0;
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
