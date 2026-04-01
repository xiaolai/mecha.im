package worker

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIsSensitivePathEdgeCases(t *testing.T) {
	tests := []struct {
		name string
		path string
		want bool
	}{
		{"empty string", "", false},
		{"single slash", "/", false},
		{"relative etc", "etc", false},
		{"etc with trailing slash content", "/etc/", true},
		{"proc with deep nesting", "/proc/1/ns/net", true},
		{"etc in middle of path", "/var/etc/something", false},
		{"home-like but not home", "/home", false},
		{"root with trailing slash", "/root/", false},
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

func TestResolveCwdSymlinkToSensitive(t *testing.T) {
	// Create a temp dir with a symlink pointing to a sensitive subdirectory
	tmpDir := t.TempDir()
	sshDir := filepath.Join(tmpDir, ".ssh")
	os.MkdirAll(sshDir, 0o700)

	link := filepath.Join(t.TempDir(), "innocent-link")
	if err := os.Symlink(sshDir, link); err != nil {
		t.Skip("symlinks not supported")
	}

	// ResolveCwd should resolve the symlink — IsSensitivePath is called by Validate, not ResolveCwd
	resolved, err := ResolveCwd(link)
	if err != nil {
		t.Fatal(err)
	}
	if resolved == link {
		t.Error("symlink should be resolved to real path")
	}
	if !strings.Contains(resolved, ".ssh") {
		t.Errorf("resolved path should contain .ssh: %s", resolved)
	}
}

func TestResolveCwdTraversal(t *testing.T) {
	// Path with /../ should be normalized by filepath.Abs
	dir := t.TempDir()
	traversal := filepath.Join(dir, "sub", "..", "sub2")
	os.MkdirAll(filepath.Join(dir, "sub2"), 0o755)

	resolved, err := ResolveCwd(traversal)
	if err != nil {
		t.Fatal(err)
	}
	// Should be a clean absolute path
	if strings.Contains(resolved, "..") {
		t.Errorf("resolved path still contains ..: %s", resolved)
	}
}

func TestValidateCwdSymlinkToSensitive(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("cannot determine home dir")
	}
	sshDir := filepath.Join(home, ".ssh")
	if _, err := os.Stat(sshDir); err != nil {
		t.Skip("~/.ssh not found")
	}

	// Create a symlink to ~/.ssh
	link := filepath.Join(t.TempDir(), "sneaky")
	if err := os.Symlink(sshDir, link); err != nil {
		t.Skip("symlinks not supported")
	}

	dc := &DockerConfig{Image: "x", Cwd: link}
	if err := dc.Validate(); err == nil {
		t.Error("expected error for symlink-to-sensitive cwd")
	}
}

func TestValidateCwdParentTraversal(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("cannot determine home dir")
	}
	// Try to mount home via traversal: $HOME/projects/../
	projects := filepath.Join(home, "projects")
	if _, err := os.Stat(projects); err != nil {
		os.MkdirAll(projects, 0o755)
		defer os.Remove(projects)
	}
	traversal := filepath.Join(projects, "..")

	dc := &DockerConfig{Image: "x", Cwd: traversal}
	if err := dc.Validate(); err == nil {
		t.Error("expected error for traversal to $HOME")
	}
}
