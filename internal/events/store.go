package events

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// ErrDuplicateDedup is returned when an event with the same dedup_key is
// already active (received, matched, or dispatched).
var ErrDuplicateDedup = errors.New("duplicate dedup key: active event exists")

// Store manages event persistence in SQLite.
type Store struct {
	db *sql.DB
}

// NewStore creates an event store.
func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

const eventColumns = `id, delivery_id, dedup_key, source, type, actor, subject,
	attrs, raw, state, worker_name, task_id, created_at, updated_at`

// Create persists a new event in received state.
// If the event has a non-empty DedupKey and an active event with the same key
// exists, returns ErrDuplicateDedup.
//
// Safety: The check-then-insert is serialized by SQLite's MaxOpenConns(1).
// If migrating to a concurrent database, wrap in a transaction.
func (s *Store) Create(ctx context.Context, ev *Event) error {
	if ev.DedupKey != "" {
		active, err := s.DedupKeyActive(ctx, ev.DedupKey)
		if err != nil {
			return fmt.Errorf("dedup check: %w", err)
		}
		if active {
			return ErrDuplicateDedup
		}
	}
	if ev.ID == "" {
		id, err := genID()
		if err != nil {
			return fmt.Errorf("generate event id: %w", err)
		}
		ev.ID = id
	}
	now := time.Now()
	ev.State = StateReceived
	ev.CreatedAt = now
	ev.UpdatedAt = now

	attrs, err := json.Marshal(ev.Attrs)
	if err != nil {
		return fmt.Errorf("marshal event attrs: %w", err)
	}

	_, err = s.db.ExecContext(ctx,
		`INSERT INTO events (id, delivery_id, dedup_key, source, type, actor, subject,
		 attrs, raw, state, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
		ev.ID, ev.DeliveryID, ev.DedupKey, ev.Source, ev.Type, ev.Actor, ev.Subject,
		string(attrs), string(ev.Raw),
		string(ev.State), now.Unix(), now.Unix(),
	)
	if err != nil {
		return fmt.Errorf("insert event: %w", err)
	}
	return nil
}

// DeliveryExists checks if a delivery ID has already been processed.
func (s *Store) DeliveryExists(ctx context.Context, deliveryID string) (bool, error) {
	if deliveryID == "" {
		return false, nil
	}
	var count int
	err := s.db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM events WHERE delivery_id = ?", deliveryID,
	).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("check delivery: %w", err)
	}
	return count > 0, nil
}

// Get retrieves an event by ID.
func (s *Store) Get(ctx context.Context, id string) (*Event, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+eventColumns+` FROM events WHERE id = ?`, id)
	return scanEvent(row)
}

// List returns events, optionally filtered by state.
func (s *Store) List(ctx context.Context, state string) ([]Event, error) {
	query := `SELECT ` + eventColumns + ` FROM events`
	var args []any
	if state != "" {
		query += " WHERE state = ?"
		args = append(args, state)
	}
	query += " ORDER BY created_at DESC LIMIT 100"
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var events []Event
	for rows.Next() {
		ev, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, *ev)
	}
	return events, rows.Err()
}

// UpdateAttrs persists hydrated attrs back to the database.
func (s *Store) UpdateAttrs(ctx context.Context, id string, attrs Attrs) error {
	data, err := json.Marshal(attrs)
	if err != nil {
		return fmt.Errorf("marshal attrs: %w", err)
	}
	now := time.Now().Unix()
	res, err := s.db.ExecContext(ctx,
		"UPDATE events SET attrs = ?, updated_at = ? WHERE id = ?",
		string(data), now, id)
	if err != nil {
		return fmt.Errorf("update attrs: %w", err)
	}
	return checkRows(res, id, "update attrs")
}

// SetMatched transitions received → matched with worker name.
func (s *Store) SetMatched(ctx context.Context, id, workerName string) error {
	return s.transitionWithExtra(ctx, id, StateReceived, StateMatched, workerName,
		"UPDATE events SET state = ?, worker_name = ?, updated_at = ? WHERE id = ? AND state = ?")
}

// SetDispatched transitions matched → dispatched with task ID.
func (s *Store) SetDispatched(ctx context.Context, id, taskID string) error {
	return s.transitionWithExtra(ctx, id, StateMatched, StateDispatched, taskID,
		"UPDATE events SET state = ?, task_id = ?, updated_at = ? WHERE id = ? AND state = ?")
}

// SetCompleted transitions dispatched → completed.
func (s *Store) SetCompleted(ctx context.Context, id string) error {
	return s.transition(ctx, id, StateDispatched, StateCompleted,
		"UPDATE events SET state = ?, updated_at = ? WHERE id = ? AND state = ?")
}

// SetFailed marks the event as failed from any active state.
func (s *Store) SetFailed(ctx context.Context, id string) error {
	now := time.Now().Unix()
	res, err := s.db.ExecContext(ctx,
		"UPDATE events SET state = ?, updated_at = ? WHERE id = ? AND state NOT IN (?, ?)",
		string(StateFailed), now, id, string(StateCompleted), string(StateSkipped))
	if err != nil {
		return fmt.Errorf("fail event: %w", err)
	}
	return checkRows(res, id, "fail")
}

// SetSkipped transitions received → skipped (no matching worker).
func (s *Store) SetSkipped(ctx context.Context, id string) error {
	return s.transition(ctx, id, StateReceived, StateSkipped,
		"UPDATE events SET state = ?, updated_at = ? WHERE id = ? AND state = ?")
}

// SetWriteBackFailed transitions dispatched → write_back_failed and records
// the error. Increments write_back_attempts on each call.
func (s *Store) SetWriteBackFailed(ctx context.Context, id, errMsg string) error {
	now := time.Now().Unix()
	res, err := s.db.ExecContext(ctx,
		`UPDATE events SET state = ?, write_back_attempts = write_back_attempts + 1,
		 write_back_last_err = ?, updated_at = ?
		 WHERE id = ? AND state IN (?, ?)`,
		string(StateWriteBackFailed), errMsg, now, id,
		string(StateDispatched), string(StateWriteBackFailed),
	)
	if err != nil {
		return fmt.Errorf("set write_back_failed: %w", err)
	}
	return checkRows(res, id, "write_back_failed")
}

// SetWriteBackCompleted transitions write_back_failed → completed after a
// successful retry.
func (s *Store) SetWriteBackCompleted(ctx context.Context, id string) error {
	now := time.Now().Unix()
	res, err := s.db.ExecContext(ctx,
		`UPDATE events SET state = ?, updated_at = ? WHERE id = ? AND state = ?`,
		string(StateCompleted), now, id, string(StateWriteBackFailed),
	)
	if err != nil {
		return fmt.Errorf("set write_back_completed: %w", err)
	}
	return checkRows(res, id, "completed")
}

// WriteBackFailed returns events whose write-back failed and are pending retry.
// Each row includes the event id, task_id, worker_name, and attempt count.
type WriteBackRetryRow struct {
	EventID          string
	TaskID           string
	WorkerName       string
	WriteBackAttempts int
}

// WriteBackFailed lists events in write_back_failed state ordered by created_at.
func (s *Store) WriteBackFailed(ctx context.Context) ([]WriteBackRetryRow, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, task_id, worker_name, write_back_attempts FROM events
		 WHERE state = ? ORDER BY created_at`,
		string(StateWriteBackFailed),
	)
	if err != nil {
		return nil, fmt.Errorf("query write_back_failed: %w", err)
	}
	defer rows.Close()
	var out []WriteBackRetryRow
	for rows.Next() {
		var r WriteBackRetryRow
		if err := rows.Scan(&r.EventID, &r.TaskID, &r.WorkerName, &r.WriteBackAttempts); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}


func (s *Store) transition(ctx context.Context, id string, from, to State, query string) error {
	now := time.Now().Unix()
	res, err := s.db.ExecContext(ctx, query, string(to), now, id, string(from))
	if err != nil {
		return fmt.Errorf("transition event %s→%s: %w", from, to, err)
	}
	return checkRows(res, id, string(to))
}

func (s *Store) transitionWithExtra(ctx context.Context, id string, from, to State, extra, query string) error {
	now := time.Now().Unix()
	res, err := s.db.ExecContext(ctx, query, string(to), extra, now, id, string(from))
	if err != nil {
		return fmt.Errorf("transition event %s→%s: %w", from, to, err)
	}
	return checkRows(res, id, string(to))
}
