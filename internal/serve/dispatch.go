package serve

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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
		// Transport failures → worker error state. Task-level failures → back to online.
		if isTransportError(err) {
			_ = s.reg.SetError(t.WorkerName, redacted)
		} else if onlineErr := s.reg.SetOnline(t.WorkerName); onlineErr != nil {
			s.logger.Warn("dispatch: set online after failure", "id", taskID, "err", onlineErr)
		}
		s.logger.Error("dispatch: send failed", "id", taskID, "err", redacted)
		return
	}

	if completeErr := s.tasks.Complete(ctx, taskID, result); completeErr != nil {
		s.logger.Error("dispatch: complete task failed — result lost", "id", taskID, "err", completeErr)
	}
	if onlineErr := s.reg.SetOnline(t.WorkerName); onlineErr != nil {
		s.logger.Warn("dispatch: set online after completion", "id", taskID, "err", onlineErr)
	}

	// Write-back: if task originated from an event, write result to GitHub
	if t.EventID != "" && s.writeback != nil && s.events != nil {
		ev, err := s.events.Get(ctx, t.EventID)
		if err == nil {
			if wbErr := s.writeback.WriteBack(ctx, ev, result); wbErr != nil {
				s.logger.Error("dispatch: write-back failed", "id", taskID, "event", ev.ID, "err", wbErr)
				// Event stays in dispatched state — can be retried
			} else {
				if err := s.events.SetCompleted(ctx, ev.ID); err != nil {
					s.logger.Error("dispatch: set event completed", "event", ev.ID, "err", err)
				}
			}
		}
	}

	s.logger.Info("task completed", "id", taskID, "worker", t.WorkerName)
}

func isTransportError(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "no such host") ||
		strings.Contains(msg, "deadline exceeded") ||
		strings.Contains(msg, "context canceled") ||
		strings.Contains(msg, "EOF")
}

func (s *Server) sendTask(ctx context.Context, endpoint, taskID, prompt string, timeout time.Duration, apiKey string) (string, error) {
	if timeout == 0 {
		timeout = 10 * time.Minute
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	payload, _ := json.Marshal(map[string]string{
		"id":     taskID,
		"prompt": prompt,
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"/task", bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := dispatchClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("send task: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("worker returned %d: %s", resp.StatusCode, worker.RedactSecrets(string(body)))
	}

	return string(body), nil
}
