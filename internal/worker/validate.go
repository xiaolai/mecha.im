package worker

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var validName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`)

// sensitivePathPrefixes are host paths that must not be bind-mounted into containers.
var sensitivePathPrefixes = []string{
	"/etc", "/proc", "/sys", "/dev", "/boot",
}

// sensitiveSubdirs are directory names that are blocked under any user's home
// (including /root). Prevents mounting credential stores into containers.
var sensitiveSubdirs = []string{".mecha", ".ssh", ".gnupg", ".aws", ".config/gcloud"}

// IsSensitivePath reports whether absPath is a protected system or credential path.
func IsSensitivePath(absPath string) bool {
	for _, prefix := range sensitivePathPrefixes {
		if absPath == prefix || strings.HasPrefix(absPath, prefix+"/") {
			return true
		}
	}
	// Block sensitive subdirs under home (including /root)
	for _, home := range userHomes() {
		for _, sub := range sensitiveSubdirs {
			blocked := filepath.Join(home, sub)
			if absPath == blocked || strings.HasPrefix(absPath, blocked+"/") {
				return true
			}
		}
	}
	return false
}

// userHomes returns home directories to protect (current user + /root).
func userHomes() []string {
	homes := []string{"/root"}
	if home, err := os.UserHomeDir(); err == nil && home != "/root" {
		homes = append(homes, home)
	}
	return homes
}

// Validate checks DockerConfig fields for correctness and security policy.
func (d *DockerConfig) Validate() error {
	if d.Image == "" {
		return fmt.Errorf("docker.image is required")
	}
	if d.Lifecycle != "" && d.Lifecycle != "persistent" && d.Lifecycle != "disposable" {
		return fmt.Errorf("docker.lifecycle must be persistent or disposable, got %q", d.Lifecycle)
	}
	if d.Expose && d.APIKey == "" {
		return fmt.Errorf("docker.api_key is required when docker.expose is true (network-accessible workers must be authenticated)")
	}
	if d.Cwd != "" {
		resolved, err := filepath.EvalSymlinks(d.Cwd)
		if err != nil {
			return fmt.Errorf("docker.cwd %q: %w", d.Cwd, err)
		}
		resolved, err = filepath.Abs(resolved)
		if err != nil {
			return fmt.Errorf("docker.cwd abs %q: %w", d.Cwd, err)
		}
		info, err := os.Stat(resolved)
		if err != nil {
			return fmt.Errorf("docker.cwd %q: %w", d.Cwd, err)
		}
		if !info.IsDir() {
			return fmt.Errorf("docker.cwd %q is not a directory", d.Cwd)
		}
		if IsSensitivePath(resolved) {
			return fmt.Errorf("docker.cwd %q resolves to sensitive path %q — mount denied", d.Cwd, resolved)
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

// validAdapterTypes are the supported adapter backend types.
var validAdapterTypes = map[string]bool{
	"ollama": true,
	"openai": true,
}

// Validate checks AdapterConfig fields.
func (a *AdapterConfig) Validate() error {
	if a.Type == "" {
		return fmt.Errorf("adapter.type is required")
	}
	if !validAdapterTypes[a.Type] {
		return fmt.Errorf("adapter.type must be ollama or openai, got %q", a.Type)
	}
	if a.Upstream == "" {
		return fmt.Errorf("adapter.upstream is required")
	}
	if a.Model == "" {
		return fmt.Errorf("adapter.model is required")
	}
	return nil
}

// validSSHModes are the supported SSH execution modes.
var validSSHModes = map[string]bool{
	"oneshot":     true,
	"interactive": true,
}

// Validate checks SSHConfig fields for correctness.
func (s *SSHConfig) Validate() error {
	if s.Host == "" {
		return fmt.Errorf("ssh.host is required")
	}
	if s.User == "" {
		return fmt.Errorf("ssh.user is required")
	}
	if s.Mode == "" {
		return fmt.Errorf("ssh.mode is required (oneshot or interactive)")
	}
	if !validSSHModes[s.Mode] {
		return fmt.Errorf("ssh.mode must be oneshot or interactive, got %q", s.Mode)
	}
	if s.Port < 0 || s.Port > 65535 {
		return fmt.Errorf("ssh.port must be 0-65535, got %d", s.Port)
	}
	if s.Key != "" {
		if _, err := os.Stat(s.Key); err != nil {
			return fmt.Errorf("ssh.key %q: %w", s.Key, err)
		}
	}
	return nil
}

