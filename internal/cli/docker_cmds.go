package cli

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"mecha.im/internal/worker"
)

// Env vars that must never be injected into worker containers.
var blockedEnvKeys = map[string]bool{
	"GITHUB_TOKEN": true, "GH_TOKEN": true,
	"GITHUB_APP_KEY": true, "GITHUB_APP_ID": true,
}

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
	mounts := buildContainerMounts(dc)

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
		User:      worker.CurrentUser(),
	}

	// Remove existing container with same name (crash recovery).
	_ = dock.Remove(context.Background(), cfg.Name)

	fmt.Printf("creating container for %s...\n", name)
	containerID, err := dock.Create(context.Background(), cfg)
	if err != nil {
		_ = reg.SetError(name, err.Error())
		return fmt.Errorf("create container: %w", err)
	}

	if err := dock.Start(context.Background(), containerID); err != nil {
		_ = dock.Remove(context.Background(), containerID)
		_ = reg.SetError(name, err.Error())
		return fmt.Errorf("start container: %w", err)
	}

	endpoint, err := waitForHealth(dock, containerID, 30*time.Second)
	if err != nil {
		_ = dock.Stop(context.Background(), containerID, 5*time.Second)
		_ = dock.Remove(context.Background(), containerID)
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

	if err := dock.Stop(context.Background(), e.ContainerID, 10*time.Second); err != nil {
		if !strings.Contains(err.Error(), "No such container") {
			return fmt.Errorf("stop container: %w", err)
		}
	}
	// Keep ContainerID for remove. Only clear runtime endpoint and state.
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

	// Try by ContainerID first, then by deterministic name.
	containerRef := e.ContainerID
	if containerRef == "" {
		containerRef = "mecha-worker-" + name
	}
	_ = dock.Stop(context.Background(), containerRef, 5*time.Second)
	_ = dock.Remove(context.Background(), containerRef)
	return reg.ClearRuntime(name)
}

func waitForHealth(dock *worker.DockerClient, id string, timeout time.Duration) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	endpoint, err := dock.Endpoint(ctx, id)
	if err != nil {
		return "", err
	}

	deadline := time.After(timeout)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-deadline:
			return "", fmt.Errorf("timed out waiting for health on %s", endpoint)
		case <-ticker.C:
			if err := worker.CheckHealth(endpoint, 3*time.Second); err == nil {
				return endpoint, nil
			}
		}
	}
}

func buildContainerEnv(dc *worker.DockerConfig) (map[string]string, error) {
	env := make(map[string]string)

	// 1. Resolve token → fail if set but unresolvable.
	if dc.Token != "" {
		secrets, err := worker.LoadSecrets(worker.DefaultSecretsPath())
		if err != nil {
			return nil, fmt.Errorf("load secrets for token %q: %w", dc.Token, err)
		}
		tokenVal, err := secrets.Resolve(dc.Token)
		if err != nil {
			return nil, fmt.Errorf("resolve token %q: %w", dc.Token, err)
		}
		envKey, envVal := worker.DetectTokenEnvVar(tokenVal)
		if envKey == "" {
			return nil, fmt.Errorf("unknown token format for %q", dc.Token)
		}
		env[envKey] = envVal
	}

	// 2. Merge explicit env (wins on collision). Block GitHub tokens.
	for k, v := range dc.Env {
		if blockedEnvKeys[k] {
			return nil, fmt.Errorf("env var %q is blocked — workers must not receive GitHub credentials", k)
		}
		env[k] = v
	}

	// 3. HOME for non-root user.
	env["HOME"] = "/tmp"
	return env, nil
}

func buildContainerMounts(dc *worker.DockerConfig) []worker.MountCfg {
	var mounts []worker.MountCfg
	if dc.Cwd != "" {
		resolved, err := filepath.EvalSymlinks(dc.Cwd)
		if err == nil {
			resolved, err = filepath.Abs(resolved)
		}
		if err == nil {
			info, statErr := os.Stat(resolved)
			if statErr == nil && info.IsDir() {
				mounts = append(mounts, worker.MountCfg{
					Source: resolved, Target: "/workspace", ReadOnly: false,
				})
			}
		}
	}
	return mounts
}
