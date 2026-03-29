package integration

import (
	"strings"
	"testing"
)

func TestError_StartNonExistent(t *testing.T) {
	reg := tempRegistry(t)
	_, stderr, code := runMecha(t, reg, "worker", "start", "ghost")
	if code == 0 {
		t.Fatal("expected non-zero exit code")
	}
	if !strings.Contains(stderr, "not found") {
		t.Errorf("stderr = %q, want 'not found'", stderr)
	}
}

func TestError_RemoveRunningWorker(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("unmanaged.yml"))
	runMecha(t, reg, "worker", "start", "test-api")

	_, stderr, code := runMecha(t, reg, "worker", "remove", "test-api")
	if code == 0 {
		t.Fatal("expected non-zero exit code")
	}
	if !strings.Contains(stderr, "must be offline") {
		t.Errorf("stderr = %q, want 'must be offline'", stderr)
	}

	// Worker should still be in registry.
	out, _, _ := runMecha(t, reg, "worker", "ls")
	if !strings.Contains(out, "test-api") {
		t.Error("worker should still exist after failed remove")
	}
}

func TestError_AddInvalidYAML(t *testing.T) {
	reg := tempRegistry(t)
	_, stderr, code := runMecha(t, reg, "worker", "add", fixturePath("invalid/broken.yml"))
	if code == 0 {
		t.Fatal("expected non-zero exit code")
	}
	if stderr == "" {
		t.Error("expected error message on stderr")
	}

	// Registry should be empty.
	out, _, _ := runMecha(t, reg, "worker", "ls")
	if !strings.Contains(out, "no workers registered") {
		t.Errorf("registry should be empty, got: %q", out)
	}
}

func TestError_AddDuplicate(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("unmanaged.yml"))
	_, stderr, code := runMecha(t, reg, "worker", "add", fixturePath("unmanaged.yml"))
	if code == 0 {
		t.Fatal("expected non-zero exit code")
	}
	if !strings.Contains(stderr, "already exists") {
		t.Errorf("stderr = %q, want 'already exists'", stderr)
	}
}

func TestError_AddMissingFile(t *testing.T) {
	reg := tempRegistry(t)
	_, stderr, code := runMecha(t, reg, "worker", "add", "nonexistent.yml")
	if code == 0 {
		t.Fatal("expected non-zero exit code")
	}
	if stderr == "" {
		t.Error("expected error message on stderr")
	}
}

func TestError_StartAlreadyOnline(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("unmanaged.yml"))
	runMecha(t, reg, "worker", "start", "test-api")

	_, stderr, code := runMecha(t, reg, "worker", "start", "test-api")
	if code == 0 {
		t.Fatal("expected non-zero exit code")
	}
	if !strings.Contains(stderr, "must be offline") {
		t.Errorf("stderr = %q, want 'must be offline'", stderr)
	}
}

func TestError_StopAlreadyOffline(t *testing.T) {
	reg := tempRegistry(t)
	runMecha(t, reg, "worker", "add", fixturePath("unmanaged.yml"))

	_, stderr, code := runMecha(t, reg, "worker", "stop", "test-api")
	if code == 0 {
		t.Fatal("expected non-zero exit code")
	}
	if !strings.Contains(stderr, "must be online") {
		t.Errorf("stderr = %q, want 'must be online'", stderr)
	}
}

func TestError_ConfigNonExistent(t *testing.T) {
	reg := tempRegistry(t)
	_, stderr, code := runMecha(t, reg, "config", "ghost")
	if code == 0 {
		t.Fatal("expected non-zero exit code")
	}
	if !strings.Contains(stderr, "not found") {
		t.Errorf("stderr = %q, want 'not found'", stderr)
	}
}
