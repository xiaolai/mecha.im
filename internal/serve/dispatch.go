package serve

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"mecha.im/internal/logs"
	"mecha.im/internal/tasks"
	"mecha.im/internal/workers"
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
			s.dispatchWg.Add(1)
			go func(id string) {
				defer s.dispatchWg.Done()
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
	queueDepth.Add(-1) // consumed from pending channel
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
	if ep == "" || entry.State != workers.StateOnline {
		if err := s.tasks.Fail(ctx, taskID, fmt.Sprintf("worker %q not available (state: %s)", t.WorkerName, entry.State)); err != nil {
			s.logger.Error("dispatch: fail task", "id", taskID, "err", err)
		}
		s.completeEvent(ctx, t.EventID, false)
		s.logger.Warn("dispatch: worker unavailable", "id", taskID, "worker", t.WorkerName, "state", entry.State)
		return
	}

	dispatchStart := time.Now()

	// Mark dispatched — skip if already dispatched (recovery path)
	if t.State == tasks.StatePending {
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

	// Rate limit check — re-queue if worker is throttled.
	// Sleep before re-queue to avoid a tight busy loop that burns CPU.
	if s.limiter != nil && !s.limiter.Allow(t.WorkerName) {
		tasksRateLimited.Add(1)
		workerRestored = true
		if onlineErr := s.reg.SetOnline(t.WorkerName); onlineErr != nil {
			s.logger.Warn("dispatch: set online after rate limit", "id", taskID, "err", onlineErr)
		}
		time.Sleep(500 * time.Millisecond)
		select {
		case s.pending <- taskID:
			s.logger.Info("dispatch: rate limited, re-queued", "id", taskID, "worker", t.WorkerName)
		default:
			s.logger.Warn("dispatch: rate limited and queue full", "id", taskID)
		}
		return
	}

	// Send task to worker (include API key if configured)
	apiKey := ""
	if entry.Worker.Docker != nil {
		apiKey = entry.Worker.Docker.APIKey
	}
	result, err := s.sendTask(ctx, ep, taskID, t.Prompt, t.Context, entry.Worker.Timeout, apiKey)
	if err != nil {
		redacted := workers.RedactSecrets(err.Error())
		// Retry transient errors; permanently fail the rest.
		if isTransportError(err) {
			retried, retryErr := s.tasks.RetryOrFail(ctx, taskID, redacted)
			if retryErr != nil {
				s.logger.Error("dispatch: retry-or-fail", "id", taskID, "err", retryErr)
			}
			if retried {
				tasksRetried.Add(1)
				s.record(logs.Entry{TraceID: t.EventID, TaskID: taskID, Worker: t.WorkerName, Action: logs.TaskRetry, Outcome: logs.Retry, Attempt: t.Attempts + 1, Error: redacted})
				s.logger.Info("dispatch: task queued for retry", "id", taskID, "worker", t.WorkerName)
			} else {
				tasksFailed.Add(1)
				s.record(logs.Entry{TraceID: t.EventID, TaskID: taskID, Worker: t.WorkerName, Action: logs.TaskDeadLetter, Outcome: logs.Fail, Attempt: t.Attempts + 1, Error: redacted})
				s.completeEvent(ctx, t.EventID, false)
				s.logger.Error("dispatch: task dead-lettered", "id", taskID, "err", redacted)
			}
			// Set worker to error state. If SetError fails (e.g. SQLite
			// busy), leave workerRestored=false so the defer safety-net
			// calls SetOnline — returning the worker to online rather than
			// leaving it permanently stuck in StateBusy.
			if setErr := s.reg.SetError(t.WorkerName, redacted); setErr != nil {
				s.logger.Error("dispatch: set worker error state", "worker", t.WorkerName, "err", setErr)
				// workerRestored remains false; defer will call SetOnline.
			} else {
				workerRestored = true
			}
		} else {
			if failErr := s.tasks.Fail(ctx, taskID, redacted); failErr != nil {
				s.logger.Error("dispatch: fail task after send error", "id", taskID, "err", failErr)
			}
			workerRestored = true
			if onlineErr := s.reg.SetOnline(t.WorkerName); onlineErr != nil {
				s.logger.Warn("dispatch: set online after failure", "id", taskID, "err", onlineErr)
			}
			tasksFailed.Add(1)
			s.completeEvent(ctx, t.EventID, false)
			s.logger.Error("dispatch: send failed", "id", taskID, "err", redacted)
		}
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
	// On success: transition event dispatched → completed.
	// On failure: transition event dispatched → write_back_failed so the
	// writeBackRetryLoop can retry without leaving the event orphaned.
	wbOk, wbErr := s.doWriteBack(ctx, taskID, t.EventID, t.WorkerName, result)
	if wbOk {
		s.completeEvent(ctx, t.EventID, true)
	} else if t.EventID != "" && s.events != nil {
		errMsg := ""
		if wbErr != nil {
			errMsg = wbErr.Error()
		}
		if setErr := s.events.SetWriteBackFailed(ctx, t.EventID, workers.RedactSecrets(errMsg)); setErr != nil {
			s.logger.Error("dispatch: set write_back_failed", "event", t.EventID, "err", setErr)
		} else {
			s.logger.Warn("dispatch: write-back failed, queued for retry", "task", taskID, "event", t.EventID)
		}
	}

	tasksCompleted.Add(1)
	latency.observe(time.Since(dispatchStart))
	s.record(logs.Entry{TraceID: t.EventID, TaskID: taskID, Worker: t.WorkerName, Action: logs.TaskSent, Outcome: logs.OK, Attempt: t.Attempts})
	s.logger.Info("task completed", "id", taskID, "worker", t.WorkerName)
}
