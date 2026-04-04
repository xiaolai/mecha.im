package cli

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"mecha.im/internal/workers"
)

const dockerTimeout = 30 * time.Second

func dockerStart(reg *workers.Registry, name string) error {
	e, ok := reg.Get(name)
	if !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	dc := e.Worker.Docker

	// Re-validate config loaded from SQLite (may predate new security rules)
	if err := dc.Validate(); err != nil {
		return fmt.Errorf("validate worker %q config: %w", name, err)
	}

	env, err := buildContainerEnv(dc)
	if err != nil {
		return err
	}
	mounts, err := buildContainerMounts(dc)
	if err != nil {
		return err
	}

	userStr, err := workers.CurrentUser()
	if err != nil {
		return fmt.Errorf("resolve user for container: %w", err)
	}

	dock, err := workers.NewDockerClient(dc.Host)
	if err != nil {
		return err
	}
	defer dock.Close()

	labels := map[string]string{"mecha.worker": name}
	for k, v := range dc.Labels {
		labels[k] = v
	}

	cfg := workers.ContainerCfg{
		Name:      "mecha-worker-" + name,
		Image:     dc.Image,
		Env:       env,
		Mounts:    mounts,
		Resources: dc.Resources,
		Labels:    labels,
		User:      userStr,
		Expose:    dc.Expose,
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
		redacted := workers.RedactSecrets(err.Error())
		if setErr := reg.SetError(name, redacted); setErr != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to set error state for %s: %v\n", name, setErr)
		}
		return fmt.Errorf("create container: %s", redacted)
	}

	ctx2, cancel2 := context.WithTimeout(context.Background(), dockerTimeout)
	defer cancel2()
	if err := dock.Start(ctx2, containerID); err != nil {
		rmCtx, rmCancel := context.WithTimeout(context.Background(), 10*time.Second)
		if rmErr := dock.Remove(rmCtx, containerID); rmErr != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to remove container %s: %v\n", containerID, rmErr)
		}
		rmCancel()
		redacted := workers.RedactSecrets(err.Error())
		if setErr := reg.SetError(name, redacted); setErr != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to set error state for %s: %v\n", name, setErr)
		}
		return fmt.Errorf("start container: %s", redacted)
	}

	endpoint, err := waitForHealth(dock, containerID, 30*time.Second)
	if err != nil {
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 10*time.Second)
		if stopErr := dock.Stop(stopCtx, containerID, 5*time.Second); stopErr != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to stop container %s: %v\n", containerID, stopErr)
		}
		if rmErr := dock.Remove(stopCtx, containerID); rmErr != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to remove container %s: %v\n", containerID, rmErr)
		}
		stopCancel()
		redacted := workers.RedactSecrets(err.Error())
		if setErr := reg.SetError(name, redacted); setErr != nil {
			fmt.Fprintf(os.Stderr, "warning: failed to set error state for %s: %v\n", name, setErr)
		}
		return fmt.Errorf("health check: %s", redacted)
	}

	return reg.SetRuntime(name, containerID, endpoint)
}

func dockerStop(reg *workers.Registry, name string) error {
	e, ok := reg.Get(name)
	if !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	if e.ContainerID == "" {
		return reg.ClearRuntime(name)
	}
	dc := e.Worker.Docker
	dock, err := workers.NewDockerClient(dc.Host)
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

func dockerRemove(reg *workers.Registry, name string) error {
	e, ok := reg.Get(name)
	if !ok {
		return nil
	}
	dc := e.Worker.Docker
	dock, err := workers.NewDockerClient(dc.Host)
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
	if err := dock.Stop(ctx, containerRef, 5*time.Second); err != nil &&
		!strings.Contains(err.Error(), "No such container") &&
		!strings.Contains(err.Error(), "not found") {
		fmt.Fprintf(os.Stderr, "warning: failed to stop container %s: %v\n", containerRef, err)
	}
	if err := dock.Remove(ctx, containerRef); err != nil &&
		!strings.Contains(err.Error(), "No such container") &&
		!strings.Contains(err.Error(), "not found") {
		fmt.Fprintf(os.Stderr, "warning: failed to remove container %s: %v\n", containerRef, err)
	}
	return reg.ClearRuntime(name)
}

func waitForHealth(dock *workers.DockerClient, id string, timeout time.Duration) (string, error) {
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
			if err := workers.CheckHealth(endpoint, 3*time.Second); err == nil {
				return endpoint, nil
			}
		}
	}
}

