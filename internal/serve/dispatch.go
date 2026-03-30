package serve

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"mecha.im/internal/worker"
)

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
			s.dispatchTask(ctx, taskID)
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
		_ = s.tasks.Fail(ctx, taskID, "worker not found")
		s.logger.Warn("dispatch: worker not found", "id", taskID, "worker", t.WorkerName)
		return
	}

	ep := entry.RuntimeEndpoint
	if ep == "" {
		ep = entry.Worker.Endpoint
	}
	if ep == "" || (entry.State != worker.StateOnline && entry.State != worker.StateBusy) {
		_ = s.tasks.Fail(ctx, taskID, fmt.Sprintf("worker %q not available (state: %s)", t.WorkerName, entry.State))
		return
	}

	// Mark dispatched
	if err := s.tasks.SetDispatched(ctx, taskID); err != nil {
		s.logger.Error("dispatch: set dispatched", "id", taskID, "err", err)
		return
	}

	// Mark worker busy (ignore error if already busy for persistent workers)
	_ = s.reg.SetBusy(t.WorkerName)

	// Send task to worker
	result, err := s.sendTask(ctx, ep, taskID, t.Prompt, entry.Worker.Timeout)
	if err != nil {
		_ = s.tasks.Fail(ctx, taskID, err.Error())
		_ = s.reg.SetOnline(t.WorkerName)
		s.logger.Error("dispatch: send failed", "id", taskID, "err", err)
		return
	}

	_ = s.tasks.Complete(ctx, taskID, result)
	_ = s.reg.SetOnline(t.WorkerName)
	s.logger.Info("task completed", "id", taskID, "worker", t.WorkerName)
}

func (s *Server) sendTask(ctx context.Context, endpoint, taskID, prompt string, timeout time.Duration) (string, error) {
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

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("send task: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("worker returned %d: %s", resp.StatusCode, string(body))
	}

	return string(body), nil
}
