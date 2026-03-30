package serve

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"mecha.im/internal/task"
	"mecha.im/internal/worker"
)

const (
	disposableHealthTimeout = 60 * time.Second
	disposableHealthPoll    = 2 * time.Second
	disposableStopTimeout   = 10 * time.Second
)

// disposableContainer creates a one-shot container, waits for health, and
// returns the endpoint plus a cleanup function. Caller must call cleanup
// when done (even on error).
func (s *Server) disposableContainer(ctx context.Context, entry worker.Entry) (endpoint string, cleanup func(), err error) {
	dc := entry.Worker.Docker
	cleanup = func() {} // safe default

	dock, err := worker.NewDockerClient(dc.Host)
	if err != nil {
		return "", cleanup, fmt.Errorf("docker client: %w", err)
	}

	suffix := randomSuffix()
	name := fmt.Sprintf("mecha-disposable-%s-%s", entry.Worker.Name, suffix)

	env, err := worker.BuildContainerEnv(dc, nil)
	if err != nil {
		dock.Close()
		return "", cleanup, fmt.Errorf("build env: %w", err)
	}
	mounts, err := worker.BuildContainerMounts(dc)
	if err != nil {
		dock.Close()
		return "", cleanup, fmt.Errorf("build mounts: %w", err)
	}
	userStr, err := worker.CurrentUser()
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

	cfg := worker.ContainerCfg{
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
		_ = dock.Stop(rmCtx, containerID, 5*time.Second)
		_ = dock.Remove(rmCtx, containerID)
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

func waitForDisposableHealth(parent context.Context, dock *worker.DockerClient, id string, timeout time.Duration) (string, error) {
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
			if err := worker.CheckHealth(ep, 3*time.Second); err == nil {
				return ep, nil
			}
		}
	}
}

// dispatchDisposable handles one-shot container lifecycle for a single task.
// Creates a fresh container, sends the task, tears it down, then completes.
func (s *Server) dispatchDisposable(ctx context.Context, taskID string, t *task.Task, entry worker.Entry) {
	if t.State == task.StatePending {
		if err := s.tasks.SetDispatched(ctx, taskID); err != nil {
			s.logger.Error("disposable: set dispatched", "id", taskID, "err", err)
			return
		}
	}

	s.logger.Info("disposable: creating container", "task", taskID, "worker", entry.Worker.Name)
	ep, cleanup, err := s.disposableContainer(ctx, entry)
	defer cleanup()

	if err != nil {
		redacted := worker.RedactSecrets(err.Error())
		_ = s.tasks.Fail(ctx, taskID, redacted)
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
		redacted := worker.RedactSecrets(err.Error())
		_ = s.tasks.Fail(ctx, taskID, redacted)
		s.completeEvent(ctx, t.EventID, false)
		s.logger.Error("disposable: send failed", "id", taskID, "err", redacted)
		return
	}

	wbOk := s.doWriteBack(ctx, taskID, t.EventID, entry.Worker.Name, result)
	if completeErr := s.tasks.Complete(ctx, taskID, result); completeErr != nil {
		s.logger.Error("disposable: complete task failed", "id", taskID, "err", completeErr)
	}
	if wbOk {
		s.completeEvent(ctx, t.EventID, true)
	}
	s.logger.Info("disposable: task completed", "id", taskID, "worker", entry.Worker.Name)
}

func randomSuffix() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}
