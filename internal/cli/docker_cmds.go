package cli

import (
	"context"
	"fmt"
	"strings"
	"time"

	"mecha.im/internal/worker"
)

const dockerTimeout = 30 * time.Second

func dockerStart(reg *worker.Registry, name string) error {
	e, ok := reg.Get(name)
	if !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	dc := e.Worker.Docker

	env, err := buildContainerEnv(dc)
	if err != nil {
		return err
	}
	mounts, err := buildContainerMounts(dc)
	if err != nil {
		return err
	}

	userStr, err := worker.CurrentUser()
	if err != nil {
		return fmt.Errorf("resolve user for container: %w", err)
	}

	dock, err := worker.NewDockerClient(dc.Host)
	if err != nil {
		return err
	}
	defer dock.Close()

	labels := map[string]string{"mecha.worker": name}
	for k, v := range dc.Labels {
		labels[k] = v
	}

	cfg := worker.ContainerCfg{
		Name:      "mecha-worker-" + name,
		Image:     dc.Image,
		Env:       env,
		Mounts:    mounts,
		Resources: dc.Resources,
		Labels:    labels,
		User:      userStr,
	}

	// Remove existing container with same name (crash recovery).
	ctx, cancel := context.WithTimeout(context.Background(), dockerTimeout)
	_ = dock.Remove(ctx, cfg.Name)
	cancel()

	fmt.Printf("creating container for %s...\n", name)
	ctx, cancel = context.WithTimeout(context.Background(), dockerTimeout)
	defer cancel()
	containerID, err := dock.Create(ctx, cfg)
	if err != nil {
		_ = reg.SetError(name, err.Error())
		return fmt.Errorf("create container: %w", err)
	}

	ctx2, cancel2 := context.WithTimeout(context.Background(), dockerTimeout)
	defer cancel2()
	if err := dock.Start(ctx2, containerID); err != nil {
		rmCtx, rmCancel := context.WithTimeout(context.Background(), 10*time.Second)
		_ = dock.Remove(rmCtx, containerID)
		rmCancel()
		_ = reg.SetError(name, err.Error())
		return fmt.Errorf("start container: %w", err)
	}

	endpoint, err := waitForHealth(dock, containerID, 30*time.Second)
	if err != nil {
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 10*time.Second)
		_ = dock.Stop(stopCtx, containerID, 5*time.Second)
		_ = dock.Remove(stopCtx, containerID)
		stopCancel()
		_ = reg.SetError(name, err.Error())
		return fmt.Errorf("health check: %w", err)
	}

	return reg.SetRuntime(name, containerID, endpoint)
}

func dockerStop(reg *worker.Registry, name string) error {
	e, ok := reg.Get(name)
	if !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	if e.ContainerID == "" {
		return reg.ClearRuntime(name)
	}
	dc := e.Worker.Docker
	dock, err := worker.NewDockerClient(dc.Host)
	if err != nil {
		return err
	}
	defer dock.Close()

	ctx, cancel := context.WithTimeout(context.Background(), dockerTimeout)
	defer cancel()
	if err := dock.Stop(ctx, e.ContainerID, 10*time.Second); err != nil {
		if !strings.Contains(err.Error(), "No such container") &&
			!strings.Contains(err.Error(), "not found") {
			return fmt.Errorf("stop container: %w", err)
		}
	}
	return reg.StopRuntime(name)
}

func dockerRemove(reg *worker.Registry, name string) error {
	e, ok := reg.Get(name)
	if !ok {
		return nil
	}
	dc := e.Worker.Docker
	dock, err := worker.NewDockerClient(dc.Host)
	if err != nil {
		return err
	}
	defer dock.Close()

	containerRef := e.ContainerID
	if containerRef == "" {
		containerRef = "mecha-worker-" + name
	}
	ctx, cancel := context.WithTimeout(context.Background(), dockerTimeout)
	defer cancel()
	_ = dock.Stop(ctx, containerRef, 5*time.Second)
	_ = dock.Remove(ctx, containerRef)
	return reg.ClearRuntime(name)
}

func waitForHealth(dock *worker.DockerClient, id string, timeout time.Duration) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	endpoint, err := dock.Endpoint(ctx, id)
	if err != nil {
		return "", err
	}

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return "", fmt.Errorf("timed out waiting for health on %s", endpoint)
		case <-ticker.C:
			if err := worker.CheckHealth(endpoint, 3*time.Second); err == nil {
				return endpoint, nil
			}
		}
	}
}

