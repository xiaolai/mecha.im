package serve

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"mecha.im/internal/task"
	"mecha.im/internal/worker"
)

var dispatchClient = &http.Client{
	Transport: &http.Transport{
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     60 * time.Second,
	},
}

func (s *Server) dispatchLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			s.logger.Info("dispatch loop stopped")
			return
		case taskID, ok := <-s.pending:
			if !ok {
				return
			}
			go func(id string) {
				defer func() {
					if r := recover(); r != nil {
						s.logger.Error("dispatch: panic", "id", id, "panic", r)
					}
				}()
				s.dispatchTask(ctx, id)
			}(taskID)
		}
	}
}

func (s *Server) dispatchTask(ctx context.Context, taskID string) {
	t, err := s.tasks.Get(ctx, taskID)
	if err != nil {
		s.logger.Error("dispatch: get task", "id", taskID, "err", err)
		return
	}

	// Reload registry from SQLite to pick up workers added by CLI
	if err := s.reg.Reload(); err != nil {
		s.logger.Error("dispatch: reload registry", "err", err)
		// Continue with stale data (Reload is safe-swap, old data preserved)
	}

	entry, ok := s.reg.Get(t.WorkerName)
	if !ok {
		if err := s.tasks.Fail(ctx, taskID, "worker not found"); err != nil {
			s.logger.Error("dispatch: fail task", "id", taskID, "err", err)
		}
		s.logger.Warn("dispatch: worker not found", "id", taskID, "worker", t.WorkerName)
		return
	}

	ep := entry.RuntimeEndpoint
	if ep == "" {
		ep = entry.Worker.Endpoint
	}
	if ep == "" || entry.State != worker.StateOnline {
		if err := s.tasks.Fail(ctx, taskID, fmt.Sprintf("worker %q not available (state: %s)", t.WorkerName, entry.State)); err != nil {
			s.logger.Error("dispatch: fail task", "id", taskID, "err", err)
		}
		s.logger.Warn("dispatch: worker unavailable", "id", taskID, "worker", t.WorkerName, "state", entry.State)
		return
	}

	// Mark dispatched — skip if already dispatched (recovery path)
	if t.State == task.StatePending {
		if err := s.tasks.SetDispatched(ctx, taskID); err != nil {
			s.logger.Error("dispatch: set dispatched", "id", taskID, "err", err)
			return
		}
	}

	// Mark worker busy — fail task if state transition fails (prevents concurrent dispatch)
	if err := s.reg.SetBusy(t.WorkerName); err != nil {
		if failErr := s.tasks.Fail(ctx, taskID, "worker busy or unavailable"); failErr != nil {
			s.logger.Error("dispatch: fail task", "id", taskID, "err", failErr)
		}
		s.logger.Warn("dispatch: worker not ready", "id", taskID, "worker", t.WorkerName, "err", err)
		return
	}

	// Send task to worker (include API key if configured)
	apiKey := ""
	if entry.Worker.Docker != nil {
		apiKey = entry.Worker.Docker.APIKey
	}
	result, err := s.sendTask(ctx, ep, taskID, t.Prompt, entry.Worker.Timeout, apiKey)
	if err != nil {
		redacted := worker.RedactSecrets(err.Error())
		if failErr := s.tasks.Fail(ctx, taskID, redacted); failErr != nil {
			s.logger.Error("dispatch: fail task after send error", "id", taskID, "err", failErr)
		}
		if isTransportError(err) {
			_ = s.reg.SetError(t.WorkerName, redacted)
		} else if onlineErr := s.reg.SetOnline(t.WorkerName); onlineErr != nil {
			s.logger.Warn("dispatch: set online after failure", "id", taskID, "err", onlineErr)
		}
		// Update event on failure
		s.completeEvent(ctx, t.EventID, false)
		s.logger.Error("dispatch: send failed", "id", taskID, "err", redacted)
		return
	}

	// Write-back BEFORE marking task complete (per result-contract.md)
	wbOk := s.doWriteBack(ctx, taskID, t.EventID, result)

	if completeErr := s.tasks.Complete(ctx, taskID, result); completeErr != nil {
		s.logger.Error("dispatch: complete task failed", "id", taskID, "err", completeErr)
	}
	if onlineErr := s.reg.SetOnline(t.WorkerName); onlineErr != nil {
		s.logger.Warn("dispatch: set online after completion", "id", taskID, "err", onlineErr)
	}

	if wbOk {
		s.completeEvent(ctx, t.EventID, true)
	}
	// If write-back failed, event stays dispatched for retry

	s.logger.Info("task completed", "id", taskID, "worker", t.WorkerName)
}

func (s *Server) doWriteBack(ctx context.Context, taskID, eventID, result string) bool {
	if eventID == "" || s.writeback == nil || s.events == nil {
		return true // no event or no writeback configured — consider success
	}
	ev, err := s.events.Get(ctx, eventID)
	if err != nil {
		s.logger.Error("dispatch: get event for writeback", "task", taskID, "err", err)
		return false
	}
	if wbErr := s.writeback.WriteBack(ctx, ev, result); wbErr != nil {
		s.logger.Error("dispatch: write-back failed", "task", taskID, "event", eventID, "err", wbErr)
		return false
	}
	return true
}

func (s *Server) completeEvent(ctx context.Context, eventID string, success bool) {
	if eventID == "" || s.events == nil {
		return
	}
	if success {
		if err := s.events.SetCompleted(ctx, eventID); err != nil {
			s.logger.Error("dispatch: set event completed", "event", eventID, "err", err)
		}
	} else {
		if err := s.events.SetFailed(ctx, eventID); err != nil {
			s.logger.Error("dispatch: set event failed", "event", eventID, "err", err)
		}
	}
}

func isTransportError(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "no such host") ||
		strings.Contains(msg, "deadline exceeded") ||
		strings.Contains(msg, "context canceled") ||
		strings.Contains(msg, "EOF")
}

