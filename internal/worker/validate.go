package worker

import (
	"fmt"
	"os"
	"path/filepath"
)

func (d *DockerConfig) validate() error {
	if d.Image == "" {
		return fmt.Errorf("docker.image is required")
	}
	if d.Lifecycle != "" && d.Lifecycle != "persistent" && d.Lifecycle != "disposable" {
		return fmt.Errorf("docker.lifecycle must be persistent or disposable, got %q", d.Lifecycle)
	}
	if d.Cwd != "" {
		resolved, err := filepath.EvalSymlinks(d.Cwd)
		if err != nil {
			return fmt.Errorf("docker.cwd %q: %w", d.Cwd, err)
		}
		info, err := os.Stat(resolved)
		if err != nil {
			return fmt.Errorf("docker.cwd %q: %w", d.Cwd, err)
		}
		if !info.IsDir() {
			return fmt.Errorf("docker.cwd %q is not a directory", d.Cwd)
		}
	}
	if d.Resources.CPU < 0 {
		return fmt.Errorf("docker.resources.cpu must be non-negative")
	}
	if d.Resources.Pids < 0 {
		return fmt.Errorf("docker.resources.pids must be non-negative")
	}
	if d.Resources.Memory != "" {
		if _, err := parseMemory(d.Resources.Memory); err != nil {
			return fmt.Errorf("docker.resources.memory: %w", err)
		}
	}
	return nil
}

func (w *Worker) applyDefaults() {
	if w.Timeout == 0 {
		w.Timeout = 10 * 60 * 1e9 // 10 minutes in nanoseconds
	}
	if w.Docker != nil {
		if w.Docker.Lifecycle == "" {
			w.Docker.Lifecycle = "persistent"
		}
	}
}
