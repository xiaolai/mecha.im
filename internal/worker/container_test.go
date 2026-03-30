package worker

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
