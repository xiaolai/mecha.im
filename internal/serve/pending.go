package serve

import (
	"context"
	"time"

	"mecha.im/internal/task"
)

const (
	pendingScanInterval = 60 * time.Second
)

// pendingLoop scans for orphaned pending tasks (created but never dispatched
// — e.g., if the channel was full when they were enqueued). Catches tasks
// that slipped through the in-memory queue.
func (s *Server) pendingLoop(ctx context.Context) {
	ticker := time.NewTicker(pendingScanInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			s.logger.Info("pending loop stopped")
			return
		case <-ticker.C:
			s.scanPending(ctx)
		}
	}
}

func (s *Server) scanPending(ctx context.Context) {
	ids, err := s.tasks.Pending(ctx)
	if err != nil {
		s.logger.Error("pending: scan failed", "err", err)
		return
	}
	for _, id := range ids {
		t, err := s.tasks.Get(ctx, id)
		if err != nil {
			s.logger.Warn("pending: get task", "id", id, "err", err)
			continue
		}
		// Skip tasks with future retry times
		if t.NextRetryAt != nil && t.NextRetryAt.After(time.Now()) {
			continue
		}
		// Skip dispatched tasks (worker is processing them)
		if t.State == task.StateDispatched {
			continue
		}
		// Dedup check: don't re-dispatch if already completed
		if t.DedupKey != "" {
			dup, err := s.tasks.HasCompletedDedup(ctx, t.DedupKey)
			if err != nil {
				s.logger.Warn("pending: dedup check", "id", id, "err", err)
				continue
			}
			if dup {
				if failErr := s.tasks.Fail(ctx, id, "skipped: duplicate of completed task"); failErr != nil {
					s.logger.Warn("pending: fail dedup task", "id", id, "err", failErr)
				}
				continue
			}
		}
		select {
		case s.pending <- id:
			s.logger.Info("pending: recovered orphan", "id", id)
		default:
			// Queue still full, will retry next scan
		}
	}
}
