package cli

import (
	"context"
	"fmt"
	"path/filepath"
	"time"

	"mecha.im/internal/worker"
)

func dockerStart(reg *worker.Registry, name string) error {
	e, ok := reg.Get(name)
	if !ok {
		return fmt.Errorf("worker %q not found", name)
	}
	dc := e.Worker.Docker
	secrets, _ := worker.LoadSecrets(worker.DefaultSecretsPath())

	dock, err := worker.NewDockerClient(dc.Host)
	if err != nil {
		return err
	}
	defer dock.Close()

	env := buildContainerEnv(dc, secrets)
	mounts := buildContainerMounts(dc)
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
		return nil
	}
	dc := e.Worker.Docker
	dock, err := worker.NewDockerClient(dc.Host)
	if err != nil {
		return err
	}
	defer dock.Close()

	_ = dock.Stop(context.Background(), e.ContainerID, 10*time.Second)
	return reg.ClearRuntime(name)
}

func dockerRemove(reg *worker.Registry, name string) error {
	e, ok := reg.Get(name)
	if !ok {
		return nil
	}
	if e.ContainerID == "" {
		return nil
	}
	dc := e.Worker.Docker
	dock, err := worker.NewDockerClient(dc.Host)
	if err != nil {
		return err
	}
	defer dock.Close()

	_ = dock.Stop(context.Background(), e.ContainerID, 5*time.Second)
	return dock.Remove(context.Background(), e.ContainerID)
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

func buildContainerEnv(dc *worker.DockerConfig, secrets *worker.Secrets) map[string]string {
	env := make(map[string]string)
	// 1. Resolve token → detect env var → set
	if dc.Token != "" && secrets != nil {
		tokenVal, err := secrets.Resolve(dc.Token)
		if err == nil {
			envKey, envVal := worker.DetectTokenEnvVar(tokenVal)
			if envKey != "" {
				env[envKey] = envVal
			}
		}
	}
	// 2. Merge explicit env (wins on collision)
	for k, v := range dc.Env {
		env[k] = v
	}
	// 3. HOME for non-root user
	env["HOME"] = "/tmp"
	return env
}

func buildContainerMounts(dc *worker.DockerConfig) []worker.MountCfg {
	var mounts []worker.MountCfg
	if dc.Cwd != "" {
		abs, err := filepath.Abs(dc.Cwd)
		if err == nil {
			mounts = append(mounts, worker.MountCfg{
				Source: abs, Target: "/workspace", ReadOnly: false,
			})
		}
	}
	return mounts
}
