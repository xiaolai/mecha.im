package event

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
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

	payload, _ := json.Marshal(ev.Payload)
	raw := string(ev.Raw)

	_, err := s.db.ExecContext(ctx,
		`INSERT INTO events (id, delivery_id, source, type, repo_owner, repo_name,
		 ref, number, sender, payload, raw, state, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		ev.ID, ev.DeliveryID, ev.Source, ev.Type, ev.RepoOwner, ev.RepoName,
		ev.Ref, ev.Number, ev.Sender, string(payload), raw,
		string(ev.State), now.Unix(), now.Unix(),
	)
	return err
}

// DeliveryExists checks if a delivery ID has already been processed.
func (s *Store) DeliveryExists(ctx context.Context, deliveryID string) bool {
	if deliveryID == "" {
		return false
	}
	var count int
	s.db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM events WHERE delivery_id = ?", deliveryID,
	).Scan(&count)
	return count > 0
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
		ev, err := scanEventRow(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, *ev)
	}
	return events, rows.Err()
}

// SetMatched transitions received → matched with worker name.
func (s *Store) SetMatched(ctx context.Context, id, workerName string) error {
	return s.updateState(ctx, id, StateMatched, "worker_name", workerName)
}

// SetDispatched transitions matched → dispatched with task ID.
func (s *Store) SetDispatched(ctx context.Context, id, taskID string) error {
	return s.updateState(ctx, id, StateDispatched, "task_id", taskID)
}

// SetCompleted marks the event as completed.
func (s *Store) SetCompleted(ctx context.Context, id string) error {
	return s.updateState(ctx, id, StateCompleted, "", "")
}

// SetFailed marks the event as failed.
func (s *Store) SetFailed(ctx context.Context, id string) error {
	return s.updateState(ctx, id, StateFailed, "", "")
}

// SetSkipped marks the event as skipped (no matching worker).
func (s *Store) SetSkipped(ctx context.Context, id string) error {
	return s.updateState(ctx, id, StateSkipped, "", "")
}

func (s *Store) updateState(ctx context.Context, id string, state State, extraCol, extraVal string) error {
	now := time.Now().Unix()
	var err error
	if extraCol != "" {
		_, err = s.db.ExecContext(ctx,
			fmt.Sprintf("UPDATE events SET state = ?, %s = ?, updated_at = ? WHERE id = ?", extraCol),
			string(state), extraVal, now, id)
	} else {
		_, err = s.db.ExecContext(ctx,
			"UPDATE events SET state = ?, updated_at = ? WHERE id = ?",
			string(state), now, id)
	}
	return err
}

type rowScanner interface{ Scan(dest ...any) error }

func scanEvent(s rowScanner) (*Event, error) {
	var ev Event
	var state, payloadStr, raw, wn, tid string
	var createdAt, updatedAt int64
	err := s.Scan(&ev.ID, &ev.DeliveryID, &ev.Source, &ev.Type,
		&ev.RepoOwner, &ev.RepoName, &ev.Ref, &ev.Number, &ev.Sender,
		&payloadStr, &raw, &state, &wn, &tid, &createdAt, &updatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("event not found")
		}
		return nil, fmt.Errorf("scan event: %w", err)
	}
	ev.State = State(state)
	ev.WorkerName = wn
	ev.TaskID = tid
	ev.Raw = json.RawMessage(raw)
	ev.CreatedAt = time.Unix(createdAt, 0)
	ev.UpdatedAt = time.Unix(updatedAt, 0)
	json.Unmarshal([]byte(payloadStr), &ev.Payload)
	return &ev, nil
}

func scanEventRow(rows *sql.Rows) (*Event, error) {
	return scanEvent(rows)
}

func genID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
