package event

import (
	"context"
	"fmt"
)

// Received returns IDs of events stuck in received state (for crash recovery).
func (s *Store) Received(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id FROM events WHERE state = ? ORDER BY created_at`,
		string(StateReceived),
	)
	if err != nil {
		return nil, fmt.Errorf("query received: %w", err)
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

// DedupKeyActive checks if a non-empty dedup_key already exists in an active
// (non-terminal) state. Active states are: received, matched, dispatched.
// Terminal states (completed, failed, skipped) do not block new events.
func (s *Store) DedupKeyActive(ctx context.Context, dedupKey string) (bool, error) {
	if dedupKey == "" {
		return false, nil
	}
	var count int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM events
		 WHERE dedup_key = ? AND state NOT IN (?, ?, ?)`,
		dedupKey,
		string(StateCompleted), string(StateFailed), string(StateSkipped),
	).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("check dedup key: %w", err)
	}
	return count > 0, nil
}
