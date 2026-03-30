package worker

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

func (r *Registry) load() error {
	rows, err := r.db.Query("SELECT name, definition, state, error_msg, container_id, endpoint, started_at FROM workers")
	if err != nil {
		return fmt.Errorf("query workers: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var name, def, state, errMsg, cid, ep string
		var startedAt sql.NullInt64
		if err := rows.Scan(&name, &def, &state, &errMsg, &cid, &ep, &startedAt); err != nil {
			return fmt.Errorf("scan worker: %w", err)
		}
		var w Worker
		if err := json.Unmarshal([]byte(def), &w); err != nil {
			return fmt.Errorf("unmarshal worker %q: %w", name, err)
		}
		e := &Entry{
			Worker:          &w,
			State:           State(state),
			Error:           errMsg,
			ContainerID:     cid,
			RuntimeEndpoint: ep,
		}
		if startedAt.Valid {
			t := time.Unix(startedAt.Int64, 0)
			e.StartedAt = &t
		}
		r.entries[name] = e
	}
	return rows.Err()
}

func (r *Registry) persist(entries map[string]*Entry) error {
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM workers"); err != nil {
		return fmt.Errorf("clear workers: %w", err)
	}
	stmt, err := tx.Prepare(`INSERT INTO workers (name, definition, state, error_msg, container_id, endpoint, started_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare insert: %w", err)
	}
	defer stmt.Close()

	for _, e := range entries {
		def, err := json.Marshal(e.Worker)
		if err != nil {
			return fmt.Errorf("marshal worker %q: %w", e.Worker.Name, err)
		}
		var startedAt sql.NullInt64
		if e.StartedAt != nil {
			startedAt = sql.NullInt64{Int64: e.StartedAt.Unix(), Valid: true}
		}
		if _, err := stmt.Exec(e.Worker.Name, string(def), string(e.State), e.Error, e.ContainerID, e.RuntimeEndpoint, startedAt); err != nil {
			return fmt.Errorf("insert worker %q: %w", e.Worker.Name, err)
		}
	}
	return tx.Commit()
}
