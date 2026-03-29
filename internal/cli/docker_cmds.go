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
// Checked case-insensitively.
var blockedEnvKeys = map[string]bool{
	"github_token": true, "gh_token": true,
	"github_app_key": true, "github_app_id": true,
	"github_app_private_key": true, "github_app_installation_id": true,
	"github_pat": true, "github_access_token": true,
	"gh_enterprise_token": true, "github_webhook_secret": true,
}

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

func buildContainerEnv(dc *worker.DockerConfig) (map[string]string, error) {
	env := make(map[string]string)

	// 1. Resolve token → fail if set but unresolvable.
	if dc.Token != "" {
		secretsPath, err := worker.DefaultSecretsPath()
		if err != nil {
			return nil, fmt.Errorf("resolve secrets path: %w", err)
		}
		secrets, err := worker.LoadSecrets(secretsPath)
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
		if blockedEnvKeys[strings.ToLower(k)] {
			return nil, fmt.Errorf("env var %q is blocked — workers must not receive GitHub credentials", k)
		}
		// Scan values for credential patterns.
		if looksLikeCredential(v) {
			return nil, fmt.Errorf("env var %q value looks like a credential — use docker.token instead", k)
		}
		env[k] = v
	}

	// 3. HOME for non-root user.
	env["HOME"] = "/tmp"
	return env, nil
}

func looksLikeCredential(v string) bool {
	return strings.HasPrefix(v, "ghp_") ||
		strings.HasPrefix(v, "ghs_") ||
		strings.HasPrefix(v, "ghr_") ||
		strings.HasPrefix(v, "gho_") ||
		strings.HasPrefix(v, "github_pat_")
}

func buildContainerMounts(dc *worker.DockerConfig) ([]worker.MountCfg, error) {
	var mounts []worker.MountCfg
	if dc.Cwd != "" {
		resolved, err := filepath.EvalSymlinks(dc.Cwd)
		if err != nil {
			return nil, fmt.Errorf("resolve cwd %q: %w", dc.Cwd, err)
		}
		resolved, err = filepath.Abs(resolved)
		if err != nil {
			return nil, fmt.Errorf("abs cwd %q: %w", dc.Cwd, err)
		}
		info, err := os.Stat(resolved)
		if err != nil {
			return nil, fmt.Errorf("stat cwd %q: %w", dc.Cwd, err)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("cwd %q is not a directory", dc.Cwd)
		}
		mounts = append(mounts, worker.MountCfg{
			Source: resolved, Target: "/workspace", ReadOnly: false,
		})
	}
	return mounts, nil
}
