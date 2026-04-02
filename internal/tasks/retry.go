package tasks

import (
	"context"
	"fmt"
	"time"
)

const (
	// DefaultMaxRetries is the default number of retry attempts before dead-letter.
	DefaultMaxRetries = 3
	// RetryBaseDelay is the base delay for exponential backoff.
	RetryBaseDelay = 30 * time.Second
)

// RetryOrFail increments the attempt counter and either re-queues for retry
// (with exponential backoff) or marks the task as permanently failed (dead-letter).
// Returns true if the task was re-queued for retry.
func (s *Store) RetryOrFail(ctx context.Context, id, errMsg string) (bool, error) {
	t, err := s.Get(ctx, id)
	if err != nil {
		return false, fmt.Errorf("get task for retry: %w", err)
	}
	attempts := t.Attempts + 1
	maxRetries := t.MaxRetries
	if maxRetries <= 0 {
		maxRetries = DefaultMaxRetries
	}

	now := time.Now()
	if attempts >= maxRetries {
		// Dead-letter: permanently failed.
		_, err := s.db.ExecContext(ctx,
			`UPDATE tasks SET state = ?, error_msg = ?, attempts = ?, updated_at = ?
			 WHERE id = ? AND state IN (?, ?)`,
			string(StateFailed), errMsg, attempts, now.Unix(),
			id, string(StatePending), string(StateDispatched),
		)
		return false, err
	}

	// Exponential backoff: baseDelay * 2^(attempts-1)
	delay := RetryBaseDelay * time.Duration(1<<(attempts-1))
	retryAt := now.Add(delay)
	_, err = s.db.ExecContext(ctx,
		`UPDATE tasks SET state = ?, error_msg = ?, attempts = ?,
		 next_retry_at = ?, updated_at = ?
		 WHERE id = ? AND state IN (?, ?)`,
		string(StatePending), errMsg, attempts, retryAt.Unix(), now.Unix(),
		id, string(StatePending), string(StateDispatched),
	)
	return err == nil, err
}

// ReadyForRetry returns IDs of pending tasks whose retry delay has elapsed.
// Tasks with next_retry_at IS NULL are immediate (not retries). Only returns
// tasks whose next_retry_at <= now.
func (s *Store) ReadyForRetry(ctx context.Context) ([]string, error) {
	now := time.Now().Unix()
	rows, err := s.db.QueryContext(ctx,
		`SELECT id FROM tasks
		 WHERE state = ? AND next_retry_at IS NOT NULL AND next_retry_at <= ?
		 ORDER BY next_retry_at`,
		string(StatePending), now,
	)
	if err != nil {
		return nil, fmt.Errorf("query retry tasks: %w", err)
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
