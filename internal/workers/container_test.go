package workers

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildContainerEnvNoToken(t *testing.T) {
	dc := &DockerConfig{
		Env: map[string]string{"FOO": "bar"},
	}
	env, err := BuildContainerEnv(dc, nil)
	if err != nil {
		t.Fatal(err)
	}
	if env["FOO"] != "bar" {
		t.Errorf("FOO = %q", env["FOO"])
	}
	if env["HOME"] != "/tmp" {
		t.Errorf("HOME = %q", env["HOME"])
	}
}

func TestBuildContainerEnvAPIKey(t *testing.T) {
	dc := &DockerConfig{APIKey: "secret-key"}
	env, err := BuildContainerEnv(dc, nil)
	if err != nil {
		t.Fatal(err)
	}
	if env["WORKER_API_KEY"] != "secret-key" {
		t.Errorf("WORKER_API_KEY = %q", env["WORKER_API_KEY"])
	}
}

func TestBuildContainerEnvValidateCallback(t *testing.T) {
	dc := &DockerConfig{
		Env: map[string]string{"BAD": "value"},
	}
	reject := func(k, v string) error {
		if k == "BAD" {
			return &validationError{k}
		}
		return nil
	}
	_, err := BuildContainerEnv(dc, reject)
	if err == nil {
		t.Error("expected validation error")
	}
	if !strings.Contains(err.Error(), "BAD") {
		t.Errorf("error = %q", err)
	}
}

type validationError struct{ key string }

func (e *validationError) Error() string { return "blocked: " + e.key }

func TestBuildContainerEnvBadToken(t *testing.T) {
	dc := &DockerConfig{Token: "claude.nonexistent"}
	_, err := BuildContainerEnv(dc, nil)
	if err == nil {
		t.Error("expected error for bad token")
	}
}

func TestBuildContainerMountsEmpty(t *testing.T) {
	dc := &DockerConfig{}
	mounts, err := BuildContainerMounts(dc)
	if err != nil {
		t.Fatal(err)
	}
	if len(mounts) != 0 {
		t.Errorf("got %d mounts", len(mounts))
	}
}

func TestBuildContainerMountsValid(t *testing.T) {
	dir := t.TempDir()
	dc := &DockerConfig{Cwd: dir}
	mounts, err := BuildContainerMounts(dc)
	if err != nil {
		t.Fatal(err)
	}
	if len(mounts) != 1 {
		t.Fatalf("got %d mounts", len(mounts))
	}
	if mounts[0].Target != "/workspace" {
		t.Errorf("target = %q", mounts[0].Target)
	}
}

func TestBuildContainerMountsSymlink(t *testing.T) {
	dir := t.TempDir()
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(dir, link); err != nil {
		t.Skip("symlinks not supported")
	}
	dc := &DockerConfig{Cwd: link}
	mounts, err := BuildContainerMounts(dc)
	if err != nil {
		t.Fatal(err)
	}
	if mounts[0].Source == link {
		t.Error("source should be resolved, not symlink")
	}
}

func TestBuildContainerMountsCredentialsSingle(t *testing.T) {
	tests := []struct {
		name   string
		cred   string
		target string
	}{
		{"claude", "claude", "/home/worker/.claude"},
		{"codex", "codex", "/home/worker/.codex"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			home, _ := os.UserHomeDir()
			hostDir := filepath.Join(home, "."+tt.name)
			if _, err := os.Stat(hostDir); err != nil {
				t.Skipf("%s not found on host", hostDir)
			}
			dc := &DockerConfig{Credentials: []string{tt.cred}}
			mounts, err := BuildContainerMounts(dc)
			if err != nil {
				t.Fatal(err)
			}
			if len(mounts) != 1 {
				t.Fatalf("got %d mounts, want 1", len(mounts))
			}
			if mounts[0].Target != tt.target {
				t.Errorf("target = %q, want %q", mounts[0].Target, tt.target)
			}
			if !mounts[0].ReadOnly {
				t.Error("credential mount should be read-only")
			}
		})
	}
}

func TestBuildContainerMountsCredentialsDual(t *testing.T) {
	home, _ := os.UserHomeDir()
	for _, dir := range []string{".claude", ".codex"} {
		if _, err := os.Stat(filepath.Join(home, dir)); err != nil {
			t.Skipf("%s not found on host", dir)
		}
	}
	dc := &DockerConfig{Credentials: []string{"claude", "codex"}}
	mounts, err := BuildContainerMounts(dc)
	if err != nil {
		t.Fatal(err)
	}
	if len(mounts) != 2 {
		t.Fatalf("got %d mounts, want 2", len(mounts))
	}
	if mounts[0].Target != "/home/worker/.claude" {
		t.Errorf("first target = %q", mounts[0].Target)
	}
	if mounts[1].Target != "/home/worker/.codex" {
		t.Errorf("second target = %q", mounts[1].Target)
	}
}

func TestBuildContainerMountsCredentialsMissing(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	dc := &DockerConfig{Credentials: []string{"codex"}}
	_, err := BuildContainerMounts(dc)
	if err == nil {
		t.Error("expected error for missing credential dir")
	}
}

func TestBuildContainerMountsCredentialsInvalid(t *testing.T) {
	dc := &DockerConfig{Credentials: []string{"invalid"}}
	_, err := BuildContainerMounts(dc)
	if err == nil {
		t.Error("expected error for invalid backend")
	}
}

func TestBuildContainerMountsCwdPlusCredentials(t *testing.T) {
	home, _ := os.UserHomeDir()
	if _, err := os.Stat(filepath.Join(home, ".claude")); err != nil {
		t.Skip(".claude not found on host")
	}
	dir := t.TempDir()
	dc := &DockerConfig{Cwd: dir, Credentials: []string{"claude"}}
	mounts, err := BuildContainerMounts(dc)
	if err != nil {
		t.Fatal(err)
	}
	if len(mounts) != 2 {
		t.Fatalf("got %d mounts, want 2", len(mounts))
	}
	if mounts[0].Target != "/workspace" {
		t.Errorf("first mount target = %q", mounts[0].Target)
	}
	if mounts[1].Target != "/home/worker/.claude" {
		t.Errorf("second mount target = %q", mounts[1].Target)
	}
}

func TestBuildContainerEnvCredentialsHome(t *testing.T) {
	dc := &DockerConfig{Credentials: []string{"codex"}}
	env, err := BuildContainerEnv(dc, nil)
	if err != nil {
		t.Fatal(err)
	}
	if env["HOME"] != "/home/worker" {
		t.Errorf("HOME = %q, want /home/worker", env["HOME"])
	}
}

func TestBuildContainerEnvNoCredentialsHome(t *testing.T) {
	dc := &DockerConfig{}
	env, err := BuildContainerEnv(dc, nil)
	if err != nil {
		t.Fatal(err)
	}
	if env["HOME"] != "/tmp" {
		t.Errorf("HOME = %q, want /tmp", env["HOME"])
	}
}

func TestBuildContainerMountsBadPath(t *testing.T) {
	dc := &DockerConfig{Cwd: "/nonexistent/path"}
	_, err := BuildContainerMounts(dc)
	if err == nil {
		t.Error("expected error")
	}
}

func TestBuildContainerMountsFile(t *testing.T) {
	f := filepath.Join(t.TempDir(), "file.txt")
	os.WriteFile(f, []byte("x"), 0o644)
	dc := &DockerConfig{Cwd: f}
	_, err := BuildContainerMounts(dc)
	if err == nil || !strings.Contains(err.Error(), "not a directory") {
		t.Errorf("error = %v", err)
	}
}
