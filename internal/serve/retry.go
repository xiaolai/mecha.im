package serve

import (
	"context"
	"time"
)

const (
	retryScanInterval = 30 * time.Second
)

// retryLoop scans for failed tasks eligible for retry and re-enqueues them.
// Runs every retryScanInterval until ctx is cancelled.
func (s *Server) retryLoop(ctx context.Context) {
	ticker := time.NewTicker(retryScanInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			s.logger.Info("retry loop stopped")
			return
		case <-ticker.C:
			s.scanRetries(ctx)
		}
	}
}

func (s *Server) scanRetries(ctx context.Context) {
	ids, err := s.tasks.ReadyForRetry(ctx)
	if err != nil {
		s.logger.Error("retry: scan failed", "err", err)
		return
	}
	for _, id := range ids {
		select {
		case s.pending <- id:
			tasksRetried.Add(1)
			s.logger.Info("retry: re-enqueued task", "id", id)
		case <-ctx.Done():
			return
		default:
			s.logger.Warn("retry: queue full, skipping", "id", id)
		}
	}
}
