package event

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// Store manages event persistence in SQLite.
type Store struct {
	db *sql.DB
}

// NewStore creates an event store.
func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// Create persists a new event in received state.
func (s *Store) Create(ctx context.Context, ev *Event) error {
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

	payload, err := json.Marshal(ev.Payload)
	if err != nil {
		return fmt.Errorf("marshal event payload: %w", err)
	}

	_, err = s.db.ExecContext(ctx,
		`INSERT INTO events (id, delivery_id, source, type, repo_owner, repo_name,
		 ref, number, sender, payload, raw, state, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		ev.ID, ev.DeliveryID, ev.Source, ev.Type, ev.RepoOwner, ev.RepoName,
		ev.Ref, ev.Number, ev.Sender, string(payload), string(ev.Raw),
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
		`SELECT id, delivery_id, source, type, repo_owner, repo_name,
		 ref, number, sender, payload, raw, state, worker_name, task_id,
		 created_at, updated_at FROM events WHERE id = ?`, id)
	return scanEvent(row)
}

// List returns events, optionally filtered by state.
func (s *Store) List(ctx context.Context, state string) ([]Event, error) {
	query := `SELECT id, delivery_id, source, type, repo_owner, repo_name,
	          ref, number, sender, payload, raw, state, worker_name, task_id,
	          created_at, updated_at FROM events`
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

