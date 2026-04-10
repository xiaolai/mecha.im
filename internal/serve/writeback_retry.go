package serve

import (
	"context"
	"time"
)

const (
	writeBackRetryInterval = 30 * time.Second
	writeBackMaxAttempts   = 5
)

// writeBackRetryLoop periodically retries write-back for events that failed
// their first write-back attempt. Events in "write_back_failed" state are
// scanned every 30 seconds. After writeBackMaxAttempts failures, the event
// is permanently failed.
//
// This loop fixes the silent data-loss bug where a transient write-back error
// (GitHub rate limit, network blip) would permanently orphan an event in
// "dispatched" state with no recovery path.
func (s *Server) writeBackRetryLoop(ctx context.Context) {
	ticker := time.NewTicker(writeBackRetryInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.scanWriteBackRetries(ctx)
		}
	}
}

func (s *Server) scanWriteBackRetries(ctx context.Context) {
	if s.events == nil {
		return
	}
	rows, err := s.events.WriteBackFailed(ctx)
	if err != nil {
		s.logger.Error("writeback-retry: list failed events", "err", err)
		return
	}
	for _, row := range rows {
		select {
		case <-ctx.Done():
			return
		default:
		}

		if row.WriteBackAttempts >= writeBackMaxAttempts {
			// Dead-letter: exceeded retry budget. Mark failed so dedup is
			// cleared and the event no longer blocks the retry scan.
			s.logger.Error("writeback-retry: dead-lettered after max attempts",
				"event", row.EventID, "attempts", row.WriteBackAttempts)
			if failErr := s.events.SetFailed(ctx, row.EventID); failErr != nil {
				s.logger.Error("writeback-retry: set failed", "event", row.EventID, "err", failErr)
			}
			writebackDeadLetter.Add(1)
			continue
		}

		// Look up the completed task to get the stored result.
		if row.TaskID == "" {
			s.logger.Warn("writeback-retry: event has no task_id, skipping", "event", row.EventID)
			continue
		}
		t, err := s.tasks.Get(ctx, row.TaskID)
		if err != nil {
			s.logger.Error("writeback-retry: get task", "event", row.EventID, "task", row.TaskID, "err", err)
			continue
		}

		s.logger.Info("writeback-retry: retrying", "event", row.EventID, "task", row.TaskID,
			"attempt", row.WriteBackAttempts+1)

		wbOk, wbErr := s.doWriteBack(ctx, row.TaskID, row.EventID, row.WorkerName, t.Result)
		if wbOk {
			if completeErr := s.events.SetWriteBackCompleted(ctx, row.EventID); completeErr != nil {
				s.logger.Error("writeback-retry: set completed", "event", row.EventID, "err", completeErr)
			} else {
				s.logger.Info("writeback-retry: succeeded", "event", row.EventID)
				writebackRetryOK.Add(1)
			}
		} else {
			errMsg := ""
			if wbErr != nil {
				errMsg = wbErr.Error()
			}
			// SetWriteBackFailed increments the attempt counter on each call.
			if setErr := s.events.SetWriteBackFailed(ctx, row.EventID, errMsg); setErr != nil {
				s.logger.Error("writeback-retry: update attempt count", "event", row.EventID, "err", setErr)
			}
			s.logger.Warn("writeback-retry: attempt failed", "event", row.EventID,
				"attempt", row.WriteBackAttempts+1, "err", errMsg)
		}
	}
}
