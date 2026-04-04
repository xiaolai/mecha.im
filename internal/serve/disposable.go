package serve

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"mecha.im/internal/logs"
	"mecha.im/internal/tasks"
	"mecha.im/internal/workers"
)

const (
	disposableHealthTimeout = 60 * time.Second
	disposableHealthPoll    = 2 * time.Second
	disposableStopTimeout   = 10 * time.Second
)

// disposableContainer creates a one-shot container, waits for health, and
// returns the endpoint plus a cleanup function. Caller must call cleanup
// when done (even on error).
func (s *Server) disposableContainer(ctx context.Context, entry workers.Entry) (endpoint string, cleanup func(), err error) {
	dc := entry.Worker.Docker
	cleanup = func() {} // safe default

	// Re-validate config loaded from SQLite (may predate new security rules)
	if err := dc.Validate(); err != nil {
		return "", cleanup, fmt.Errorf("validate config: %w", err)
	}

	dock, err := workers.NewDockerClient(dc.Host)
	if err != nil {
		return "", cleanup, fmt.Errorf("docker client: %w", err)
	}

	suffix := randomSuffix()
	name := fmt.Sprintf("mecha-disposable-%s-%s", entry.Worker.Name, suffix)

	env, err := workers.BuildContainerEnv(dc, validateDisposableEnv)
	if err != nil {
		dock.Close()
		return "", cleanup, fmt.Errorf("build env: %w", err)
	}
	mounts, err := workers.BuildContainerMounts(dc)
	if err != nil {
		dock.Close()
		return "", cleanup, fmt.Errorf("build mounts: %w", err)
	}
	userStr, err := workers.CurrentUser()
	if err != nil {
		dock.Close()
		return "", cleanup, fmt.Errorf("resolve user: %w", err)
	}

	labels := map[string]string{
		"mecha.worker":    entry.Worker.Name,
		"mecha.lifecycle": "disposable",
	}
	for k, v := range dc.Labels {
		labels[k] = v
	}

	cfg := workers.ContainerCfg{
		Name:      name,
		Image:     dc.Image,
		Env:       env,
		Mounts:    mounts,
		Resources: dc.Resources,
		Labels:    labels,
		User:      userStr,
		Expose:    dc.Expose,
	}

	containerID, err := dock.Create(ctx, cfg)
	if err != nil {
		dock.Close()
		return "", cleanup, fmt.Errorf("create container: %w", err)
	}

	// Cleanup removes and closes regardless of state
	cleanup = func() {
		rmCtx, cancel := context.WithTimeout(context.Background(), disposableStopTimeout)
		defer cancel()
		if stopErr := dock.Stop(rmCtx, containerID, 5*time.Second); stopErr != nil {
			s.logger.Warn("disposable: stop cleanup failed", "container", containerID, "err", stopErr)
		}
		if rmErr := dock.Remove(rmCtx, containerID); rmErr != nil {
			s.logger.Warn("disposable: remove cleanup failed", "container", containerID, "err", rmErr)
		}
		dock.Close()
	}

	if err := dock.Start(ctx, containerID); err != nil {
		return "", cleanup, fmt.Errorf("start container: %w", err)
	}

	ep, err := waitForDisposableHealth(ctx, dock, containerID, disposableHealthTimeout)
	if err != nil {
		return "", cleanup, fmt.Errorf("health check: %w", err)
	}
	return ep, cleanup, nil
}

func waitForDisposableHealth(parent context.Context, dock *workers.DockerClient, id string, timeout time.Duration) (string, error) {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	ep, err := dock.Endpoint(ctx, id)
	if err != nil {
		return "", err
	}

	ticker := time.NewTicker(disposableHealthPoll)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return "", fmt.Errorf("timed out waiting for health on %s", ep)
		case <-ticker.C:
			if err := workers.CheckHealth(ep, 3*time.Second); err == nil {
				return ep, nil
			}
		}
	}
}

// dispatchDisposable handles one-shot container lifecycle for a single task.
// Creates a fresh container, sends the task, tears it down, then completes.
func (s *Server) dispatchDisposable(ctx context.Context, taskID string, t *tasks.Task, entry workers.Entry) {
	if t.State == tasks.StatePending {
		if err := s.tasks.SetDispatched(ctx, taskID); err != nil {
			s.logger.Error("disposable: set dispatched", "id", taskID, "err", err)
			return
		}
	}

	s.logger.Info("disposable: creating container", "task", taskID, "worker", entry.Worker.Name)
	ep, cleanup, err := s.disposableContainer(ctx, entry)
	defer cleanup()

	if err != nil {
		redacted := workers.RedactSecrets(err.Error())
		if failErr := s.tasks.Fail(ctx, taskID, redacted); failErr != nil {
			s.logger.Error("disposable: fail task", "id", taskID, "err", failErr)
		}
		s.completeEvent(ctx, t.EventID, false)
		s.logger.Error("disposable: container failed", "id", taskID, "err", redacted)
		return
	}

	apiKey := ""
	if entry.Worker.Docker != nil {
		apiKey = entry.Worker.Docker.APIKey
	}
	result, err := s.sendTask(ctx, ep, taskID, t.Prompt, entry.Worker.Timeout, apiKey)
	if err != nil {
		redacted := workers.RedactSecrets(err.Error())
		if failErr := s.tasks.Fail(ctx, taskID, redacted); failErr != nil {
			s.logger.Error("disposable: fail task after send", "id", taskID, "err", failErr)
		}
		tasksFailed.Add(1)
		s.completeEvent(ctx, t.EventID, false)
		s.logger.Error("disposable: send failed", "id", taskID, "err", redacted)
		return
	}

	// Complete task before write-back to prevent duplicate side effects on recovery
	if completeErr := s.tasks.Complete(ctx, taskID, result); completeErr != nil {
		s.logger.Error("disposable: complete task failed", "id", taskID, "err", completeErr)
		return
	}
	wbOk := s.doWriteBack(ctx, taskID, t.EventID, entry.Worker.Name, result)
	if wbOk {
		s.completeEvent(ctx, t.EventID, true)
	}
	tasksCompleted.Add(1)
	s.record(logs.Entry{TraceID: t.EventID, TaskID: taskID, Worker: entry.Worker.Name, Action: logs.TaskSent, Outcome: logs.OK, Attempt: t.Attempts})
	s.logger.Info("disposable: task completed", "id", taskID, "worker", entry.Worker.Name)
}

// validateDisposableEnv rejects reserved runtime env keys in docker.env.
func validateDisposableEnv(k, _ string) error {
	lower := strings.ToLower(k)
	if strings.HasPrefix(lower, "worker_") || lower == "home" {
		return fmt.Errorf("env var %q is reserved by mecha runtime", k)
	}
	return nil
}

func randomSuffix() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// Fallback to timestamp-based suffix if entropy unavailable
		return hex.EncodeToString([]byte(fmt.Sprintf("%08x", time.Now().UnixNano())))
	}
	return hex.EncodeToString(b)
}
