package serve

import (
	"context"
	"time"

	"mecha.im/internal/events"
	"mecha.im/internal/source"
)

// recoverTasks re-enqueues pending tasks from a previous run.
// Dedup-completed tasks are skipped to prevent duplicate side effects.
func (s *Server) recoverTasks(ctx context.Context) error {
	ids, err := s.tasks.Pending(ctx)
	if err != nil {
		return err
	}
	for _, id := range ids {
		t, getErr := s.tasks.Get(ctx, id)
		if getErr != nil {
			s.logger.Warn("recover: get task failed", "id", id, "err", getErr)
			continue
		}
		if t.DedupKey != "" {
			dup, dupErr := s.tasks.HasCompletedDedup(ctx, t.DedupKey)
			if dupErr != nil {
				s.logger.Warn("recover: dedup check failed", "id", id, "err", dupErr)
				continue
			}
			if dup {
				tasksDedupSkip.Add(1)
				s.logger.Info("recover: skipping duplicate task", "id", id, "dedup_key", t.DedupKey)
				if failErr := s.tasks.Fail(ctx, id, "skipped: duplicate of completed task"); failErr != nil {
					s.logger.Warn("recover: fail dedup task", "id", id, "err", failErr)
				}
				continue
			}
		}
		select {
		case s.pending <- id:
			tasksRecovered.Add(1)
			s.logger.Info("recovered task", "id", id)
		default:
			s.logger.Warn("pending queue full, skipping recovery", "id", id)
		}
	}
	return nil
}

// recoverEvents re-processes events stuck in "received" state.
// If the source is still registered, re-runs matchAndHydrate; otherwise
// marks as failed for manual review.
func (s *Server) recoverEvents(ctx context.Context) {
	if s.events == nil || s.sources == nil {
		return
	}
	stuckIDs, err := s.events.Received(ctx)
	if err != nil {
		s.logger.Error("recover received events", "err", err)
		return
	}
	for _, eid := range stuckIDs {
		ev, err := s.events.Get(ctx, eid)
		if err != nil {
			s.logger.Error("recover: get event", "event", eid, "err", err)
			continue
		}
		src, ok := s.sources.Get(ev.Source)
		if !ok {
			if err := s.events.SetFailed(ctx, eid); err != nil {
				s.logger.Error("recover: fail event", "event", eid, "err", err)
			}
			s.logger.Warn("recovered stuck event (source gone, marked failed)", "event", eid, "source", ev.Source)
			continue
		}
		s.logger.Info("recovering stuck event", "event", eid, "source", ev.Source)
		s.dispatchWg.Add(1)
		go func(ev *events.Event, src source.Source) {
			defer s.dispatchWg.Done()
			rctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()
			s.matchAndHydrate(rctx, ev, src)
		}(ev, src)
	}
}
