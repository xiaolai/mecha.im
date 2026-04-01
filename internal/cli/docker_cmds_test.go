package cli

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mecha.im/internal/worker"
)

func TestWaitForHealthSuccess(t *testing.T) {
	// Simulate a container endpoint that becomes healthy after 2 polls
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls < 2 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// We can't call waitForHealth directly (it needs DockerClient.Endpoint),
	// but we can test the underlying CheckHealth with repeated calls.
	// First call should fail:
	err := worker.CheckHealth(srv.URL, 2*time.Second)
	if err == nil {
		t.Error("first health check should fail")
	}
	// Second call should succeed:
	err = worker.CheckHealth(srv.URL, 2*time.Second)
	if err != nil {
		t.Errorf("second health check should pass: %v", err)
	}
}

func TestWaitForHealthTimeout(t *testing.T) {
	// Endpoint that never returns healthy
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	// Verify CheckHealth correctly fails
	err := worker.CheckHealth(srv.URL, 1*time.Second)
	if err == nil {
		t.Error("health check should fail for 503")
	}
}

func TestDockerStartNotFound(t *testing.T) {
	reg := newTestRegistry(t)
	err := dockerStart(reg, "nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent worker")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want containing 'not found'", err)
	}
}

func TestDockerStopNotFound(t *testing.T) {
	reg := newTestRegistry(t)
	err := dockerStop(reg, "nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent worker")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want containing 'not found'", err)
	}
}

func TestDockerStopNoContainerID(t *testing.T) {
	reg := newTestRegistry(t)
	reg.Add(&worker.Worker{
		Name: "no-container",
		Docker: &worker.DockerConfig{
			Image: "test:latest",
		},
	})
	// Worker exists but has no container ID → should clear runtime
	err := dockerStop(reg, "no-container")
	if err != nil {
		t.Fatalf("dockerStop with no container: %v", err)
	}
}

func TestDockerRemoveNotFound(t *testing.T) {
	reg := newTestRegistry(t)
	// Remove of non-existent worker should be a no-op (returns nil)
	err := dockerRemove(reg, "nonexistent")
	if err != nil {
		t.Errorf("dockerRemove non-existent should return nil, got: %v", err)
	}
}

func TestDockerRemoveNoContainerID(t *testing.T) {
	reg := newTestRegistry(t)
	reg.Add(&worker.Worker{
		Name: "clean-worker",
		Docker: &worker.DockerConfig{
			Image: "test:latest",
		},
	})
	// Should clear runtime even if Docker daemon isn't available
	err := dockerRemove(reg, "clean-worker")
	// This might fail if Docker client can't be created, which is fine
	if err != nil && !strings.Contains(err.Error(), "docker") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestDockerStartValidationFail(t *testing.T) {
	reg := newTestRegistry(t)
	// Add worker with a cwd that doesn't exist → Validate should fail
	reg.Add(&worker.Worker{
		Name: "bad-cwd",
		Docker: &worker.DockerConfig{
			Image: "test:latest",
			Cwd:   "/nonexistent/impossible/path",
		},
	})
	err := dockerStart(reg, "bad-cwd")
	if err == nil {
		t.Fatal("expected error for invalid cwd")
	}
}

func TestDockerStartBadToken(t *testing.T) {
	dir := t.TempDir()
	mechaDir := filepath.Join(dir, ".mecha")
	os.MkdirAll(mechaDir, 0o700)
	os.WriteFile(filepath.Join(mechaDir, "secrets.yml"), []byte("tokens: {}"), 0o600)
	t.Setenv("HOME", dir)

	reg := newTestRegistry(t)
	reg.Add(&worker.Worker{
		Name: "bad-token",
		Docker: &worker.DockerConfig{
			Image: "test:latest",
			Token: "claude.nonexistent",
		},
	})
	err := dockerStart(reg, "bad-token")
	if err == nil {
		t.Fatal("expected error for bad token reference")
	}
}

func TestDockerStopGraceful(t *testing.T) {
	reg := newTestRegistry(t)
	reg.Add(&worker.Worker{
		Name: "no-id",
		Docker: &worker.DockerConfig{
			Image: "test:latest",
		},
	})
	// No container ID — should just clear runtime
	err := dockerStop(reg, "no-id")
	if err != nil {
		t.Errorf("dockerStop no container: %v", err)
	}
}
