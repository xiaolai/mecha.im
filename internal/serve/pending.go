package serve

import (
	"context"
	"time"

	"mecha.im/internal/tasks"
)

const (
	pendingScanInterval = 60 * time.Second
	// staleDispatchTimeout is how long a task may remain in "dispatched" state
	// before the pending scan re-enqueues it. Must exceed the longest realistic
	// task timeout (default 10m) to avoid racing with an active dispatch goroutine.
	staleDispatchTimeout = 15 * time.Minute
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
			func() {
				defer func() {
					if r := recover(); r != nil {
						s.logger.Error("pending loop: panic", "panic", r)
					}
				}()
				s.scanPending(ctx)
			}()
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
		// Skip dispatched tasks that are still within the staleness window.
		// Re-enqueue stale dispatched tasks: a dispatch goroutine that panicked
		// after SetBusy leaves the task stuck in "dispatched" forever because
		// Complete/Fail never run. After staleDispatchTimeout (15m > any task
		// timeout), we can safely assume the original goroutine is gone.
		if t.State == tasks.StateDispatched {
			if time.Since(t.UpdatedAt) < staleDispatchTimeout {
				continue
			}
			s.logger.Warn("pending: stale dispatched task, re-enqueuing", "id", id, "age", time.Since(t.UpdatedAt).Truncate(time.Second))
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
			s.logger.Warn("pending: queue full, skipping orphan", "id", id)
		}
	}
}
