package logs

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"mecha.im/internal/redact"
)

// Store persists log entries to SQLite and provides query access.
type Store struct {
	db     *sql.DB
	logger *slog.Logger
}

// NewStore creates an audit store.
func NewStore(db *sql.DB, logger *slog.Logger) *Store {
	if logger == nil {
		logger = slog.Default()
	}
	return &Store{db: db, logger: logger}
}

// Record persists an audit entry. Fire-and-forget for non-critical entries:
// errors are logged but never propagated to the caller.
func (s *Store) Record(e Entry) {
	if e.TS == 0 {
		e.TS = time.Now().Unix()
	}
	// Redact secrets from error and detail fields.
	e.Error = redact.Secrets(e.Error)
	e.Detail = redact.Secrets(e.Detail)

	_, err := s.db.Exec(
		`INSERT INTO logs (trace_id, ts, action, outcome, event_id, task_id, worker, attempt, error, detail)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.TraceID, e.TS, e.Action, e.Outcome,
		e.EventID, e.TaskID, e.Worker, e.Attempt,
		e.Error, e.Detail,
	)
	if err != nil {
		s.logger.Warn("logs: write failed", "action", e.Action, "err", err)
	}
}

// Query returns log entries matching the filter.
func (s *Store) Query(ctx context.Context, f Filter) ([]Entry, error) {
	if f.Limit <= 0 {
		f.Limit = 100
	}
	if f.Limit > 1000 {
		f.Limit = 1000
	}

	var where []string
	var args []any

	if f.TraceID != "" {
		where = append(where, "trace_id = ?")
		args = append(args, f.TraceID)
	}
	if f.EventID != "" {
		where = append(where, "event_id = ?")
		args = append(args, f.EventID)
	}
	if f.TaskID != "" {
		where = append(where, "task_id = ?")
		args = append(args, f.TaskID)
	}
	if f.Worker != "" {
		where = append(where, "worker = ?")
		args = append(args, f.Worker)
	}
	if f.Action != "" {
		// Prefix match: "policy" matches "policy.applied"
		where = append(where, "action LIKE ?")
		args = append(args, f.Action+"%")
	}
	if !f.Since.IsZero() {
		where = append(where, "ts >= ?")
		args = append(args, f.Since.Unix())
	}
	if !f.Until.IsZero() {
		where = append(where, "ts <= ?")
		args = append(args, f.Until.Unix())
	}

	query := "SELECT id, trace_id, ts, action, outcome, event_id, task_id, worker, attempt, error, detail FROM logs"
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY id DESC LIMIT ?"
	args = append(args, f.Limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("logs query: %w", err)
	}
	defer rows.Close()

	var entries []Entry
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.ID, &e.TraceID, &e.TS, &e.Action, &e.Outcome,
			&e.EventID, &e.TaskID, &e.Worker, &e.Attempt, &e.Error, &e.Detail); err != nil {
			return nil, fmt.Errorf("logs scan: %w", err)
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// Prune deletes entries older than the given time. Returns count deleted.
func (s *Store) Prune(ctx context.Context, before time.Time) (int64, error) {
	res, err := s.db.ExecContext(ctx, "DELETE FROM logs WHERE ts < ?", before.Unix())
	if err != nil {
		return 0, fmt.Errorf("logs prune: %w", err)
	}
	return res.RowsAffected()
}

// MarshalDetail converts a map to a redacted JSON string for the Detail field.
func MarshalDetail(v any) string {
	data, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return redact.Secrets(string(data))
}
