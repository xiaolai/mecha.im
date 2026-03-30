package store

const schemaSQL = `
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
