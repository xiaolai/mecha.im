package serve

import (
	"context"
	"fmt"
	"net/http"
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

const maxConcurrentDispatches = 16

func (s *Server) dispatchLoop(ctx context.Context) {
	sem := make(chan struct{}, maxConcurrentDispatches)
	for {
		select {
		case <-ctx.Done():
			s.logger.Info("dispatch loop stopped")
			return
		case taskID, ok := <-s.pending:
			if !ok {
				return
			}
			select {
			case sem <- struct{}{}: // acquire slot
			case <-ctx.Done():
				s.logger.Warn("dispatch: shutdown while waiting for slot", "task", taskID)
				return
			}
			go func(id string) {
				defer func() { <-sem }() // release slot
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

	entry, ok := s.reg.Get(t.WorkerName)
	if !ok {
		if err := s.tasks.Fail(ctx, taskID, "worker not found"); err != nil {
			s.logger.Error("dispatch: fail task", "id", taskID, "err", err)
		}
		s.logger.Warn("dispatch: worker not found", "id", taskID, "worker", t.WorkerName)
		return
	}

	// Disposable workers get a one-shot container per task
	if entry.Worker.Docker != nil && entry.Worker.Docker.Lifecycle == "disposable" {
		s.dispatchDisposable(ctx, taskID, t, entry)
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
	// Safety net: restore worker from busy state on panic (defers run before panic propagates)
	workerRestored := false
	defer func() {
		if !workerRestored {
			if err := s.reg.SetOnline(t.WorkerName); err != nil {
				s.logger.Warn("dispatch: restore worker after panic", "worker", t.WorkerName, "err", err)
			}
		}
	}()

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
		workerRestored = true
		if isTransportError(err) {
			if setErr := s.reg.SetError(t.WorkerName, redacted); setErr != nil {
				s.logger.Error("dispatch: set worker error state", "worker", t.WorkerName, "err", setErr)
			}
		} else if onlineErr := s.reg.SetOnline(t.WorkerName); onlineErr != nil {
			s.logger.Warn("dispatch: set online after failure", "id", taskID, "err", onlineErr)
		}
		// Update event on failure
		s.completeEvent(ctx, t.EventID, false)
		s.logger.Error("dispatch: send failed", "id", taskID, "err", redacted)
		return
	}

	// Complete task FIRST (durable), then write-back (side effects).
	// This prevents duplicate side effects on recovery: if mecha crashes
	// after write-back but before task completion, recovery would re-dispatch
	// and duplicate comments/labels/statuses.
	if completeErr := s.tasks.Complete(ctx, taskID, result); completeErr != nil {
		s.logger.Error("dispatch: complete task failed", "id", taskID, "err", completeErr)
		workerRestored = true
		if onlineErr := s.reg.SetOnline(t.WorkerName); onlineErr != nil {
			s.logger.Warn("dispatch: set online after completion", "id", taskID, "err", onlineErr)
		}
		return
	}
	workerRestored = true
	if onlineErr := s.reg.SetOnline(t.WorkerName); onlineErr != nil {
		s.logger.Warn("dispatch: set online after completion", "id", taskID, "err", onlineErr)
	}

	// Write-back after task is durably completed.
	// Event completion is gated on write-back success — failed events stay
	// "dispatched" for retry, which creates a new task on re-dispatch.
	wbOk := s.doWriteBack(ctx, taskID, t.EventID, t.WorkerName, result)
	if wbOk {
		s.completeEvent(ctx, t.EventID, true)
	}

	s.logger.Info("task completed", "id", taskID, "worker", t.WorkerName)
}


