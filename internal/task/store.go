package task

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// Store manages task persistence in SQLite.
type Store struct {
	db *sql.DB
}

// NewStore creates a task store backed by the given database.
func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// Create inserts a new task in pending state and returns it.
func (s *Store) Create(ctx context.Context, workerName, prompt string) (*Task, error) {
	return s.CreateWithEvent(ctx, workerName, prompt, "{}", "")
}

// CreateWithEvent inserts a task with event context and optional event ID.
func (s *Store) CreateWithEvent(ctx context.Context, workerName, prompt, taskCtx, eventID string) (*Task, error) {
	id, err := genID()
	if err != nil {
		return nil, fmt.Errorf("generate task id: %w", err)
	}
	now := time.Now()
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO tasks (id, worker_name, prompt, context, event_id, state, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, workerName, prompt, taskCtx, eventID, string(StatePending), now.Unix(), now.Unix(),
	)
	if err != nil {
		return nil, fmt.Errorf("insert task: %w", err)
	}
	return &Task{
		ID:         id,
		WorkerName: workerName,
		Prompt:     prompt,
		Context:    taskCtx,
		EventID:    eventID,
		State:      StatePending,
		CreatedAt:  now,
		UpdatedAt:  now,
	}, nil
}

// Get retrieves a task by ID.
func (s *Store) Get(ctx context.Context, id string) (*Task, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, worker_name, prompt, context, event_id, state, result, error_msg,
		        created_at, updated_at, dispatched_at, completed_at
		 FROM tasks WHERE id = ?`, id)
	return scanTask(row)
}

// List returns all tasks, optionally filtered by state.
func (s *Store) List(ctx context.Context, state string) ([]Task, error) {
	query := `SELECT id, worker_name, prompt, context, event_id, state, result, error_msg,
	                  created_at, updated_at, dispatched_at, completed_at
	           FROM tasks`
	var args []any
	if state != "" {
		query += " WHERE state = ?"
		args = append(args, state)
	}
	query += " ORDER BY created_at DESC"
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list tasks: %w", err)
	}
	defer rows.Close()
	var tasks []Task
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, *t)
	}
	return tasks, rows.Err()
}

// SetDispatched marks a task as dispatched to a worker.
func (s *Store) SetDispatched(ctx context.Context, id string) error {
	now := time.Now()
	res, err := s.db.ExecContext(ctx,
		`UPDATE tasks SET state = ?, dispatched_at = ?, updated_at = ? WHERE id = ? AND state = ?`,
		string(StateDispatched), now.Unix(), now.Unix(), id, string(StatePending),
	)
	if err != nil {
		return fmt.Errorf("dispatch task: %w", err)
	}
	return checkRowAffected(res, id, "dispatch")
}

// Complete marks a task as completed with a result.
func (s *Store) Complete(ctx context.Context, id, result string) error {
	now := time.Now()
	res, err := s.db.ExecContext(ctx,
		`UPDATE tasks SET state = ?, result = ?, completed_at = ?, updated_at = ? WHERE id = ? AND state = ?`,
		string(StateCompleted), result, now.Unix(), now.Unix(), id, string(StateDispatched),
	)
	if err != nil {
		return fmt.Errorf("complete task: %w", err)
	}
	return checkRowAffected(res, id, "complete")
}

// Fail marks a task as failed with an error message.
func (s *Store) Fail(ctx context.Context, id, errMsg string) error {
	now := time.Now()
	res, err := s.db.ExecContext(ctx,
		`UPDATE tasks SET state = ?, error_msg = ?, updated_at = ? WHERE id = ? AND state IN (?, ?)`,
		string(StateFailed), errMsg, now.Unix(), id, string(StatePending), string(StateDispatched),
	)
	if err != nil {
		return fmt.Errorf("fail task: %w", err)
	}
	return checkRowAffected(res, id, "fail")
}

// Pending returns IDs of tasks in pending or dispatched state (for recovery).
func (s *Store) Pending(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id FROM tasks WHERE state IN (?, ?) ORDER BY created_at`,
		string(StatePending), string(StateDispatched),
	)
	if err != nil {
		return nil, fmt.Errorf("query pending: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

