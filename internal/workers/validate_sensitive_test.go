package workers

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIsSensitivePathSystemPaths(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{"/etc", true},
		{"/etc/passwd", true},
		{"/proc", true},
		{"/proc/1/status", true},
		{"/sys", true},
		{"/dev", true},
		{"/boot", true},
		{"/usr/local/bin", false},
		{"/var/log", false},
		{"/tmp", false},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			got := IsSensitivePath(tt.path)
			if got != tt.want {
				t.Errorf("IsSensitivePath(%q) = %v, want %v", tt.path, got, tt.want)
			}
		})
	}
}

func TestIsSensitivePathHomeRoot(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("cannot determine home dir")
	}
	tests := []struct {
		name string
		path string
		want bool
	}{
		{"home itself", home, true},
		{"home subdir safe", filepath.Join(home, "projects"), false},
		{"home subdir nested safe", filepath.Join(home, "projects", "myapp"), false},
		{"home .ssh", filepath.Join(home, ".ssh"), true},
		{"home .ssh subdir", filepath.Join(home, ".ssh", "keys"), true},
		{"home .claude", filepath.Join(home, ".claude"), true},
		{"home .codex", filepath.Join(home, ".codex"), true},
		{"home .gemini", filepath.Join(home, ".gemini"), true},
		{"home .mecha", filepath.Join(home, ".mecha"), true},
		{"home .gnupg", filepath.Join(home, ".gnupg"), true},
		{"home .aws", filepath.Join(home, ".aws"), true},
		{"home .config/gcloud", filepath.Join(home, ".config/gcloud"), true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsSensitivePath(tt.path)
			if got != tt.want {
				t.Errorf("IsSensitivePath(%q) = %v, want %v", tt.path, got, tt.want)
			}
		})
	}
}

func TestIsSensitivePathRootHome(t *testing.T) {
	tests := []struct {
		name string
		path string
		want bool
	}{
		{"root itself", "/root", true},
		{"root .ssh", "/root/.ssh", true},
		{"root .claude", "/root/.claude", true},
		{"root subdir safe", "/root/work", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsSensitivePath(tt.path)
			if got != tt.want {
				t.Errorf("IsSensitivePath(%q) = %v, want %v", tt.path, got, tt.want)
			}
		})
	}
}

func TestValidateCwdRejectsSensitivePaths(t *testing.T) {
	// Use a real temp dir for the safe case
	safeDir := t.TempDir()
	dc := &DockerConfig{Image: "x", Cwd: safeDir}
	if err := dc.Validate(); err != nil {
		t.Errorf("safe cwd rejected: %v", err)
	}

	// Home itself should be rejected (if it exists as a dir)
	home, _ := os.UserHomeDir()
	dc2 := &DockerConfig{Image: "x", Cwd: home}
	if err := dc2.Validate(); err == nil {
		t.Error("expected error for cwd = $HOME")
	}
}
