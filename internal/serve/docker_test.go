package serve

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"mecha.im/internal/events"
	"mecha.im/internal/source"
	"mecha.im/internal/store"
	"mecha.im/internal/tasks"
	"mecha.im/internal/workers"
)

func dockerAvailable() bool {
	dc, err := workers.NewDockerClient("")
	if err != nil {
		return false
	}
	defer dc.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = dc.Ping(ctx)
	return err == nil
}

func testServerWithDocker(t *testing.T) (*Server, func()) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatal(err)
	}
	taskStore := tasks.NewStore(db)
	evStore := events.NewStore(db)

	dc, err := workers.NewDockerClient("")
	if err != nil {
		t.Fatal(err)
	}

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))

	s := New(Config{
		Registry: reg,
		Tasks:    taskStore,
		Events:   evStore,
		Sources:  source.NewRegistry(),
		Docker:   dc,
		Addr:     "127.0.0.1:0",
		Logger:   logger,
	})
	return s, func() {
		dc.Close()
		db.Close()
	}
}

func TestDisposableContainerCreatesAndCleansUp(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("Docker daemon not available")
	}

	s, cleanup := testServerWithDocker(t)
	defer cleanup()

	entry := workers.Entry{
		Worker: &workers.Worker{
			Name: "disp-test",
			Docker: &workers.DockerConfig{
				Image:     "mecha-worker:latest",
				Lifecycle: "disposable",
			},
			Timeout: 2 * time.Minute,
		},
	}

	// Use a short timeout — the container won't pass health check without auth,
	// but this exercises Create, Start, health polling, timeout, and cleanup.
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	_, cleanupFn, err := s.disposableContainer(ctx, entry)
	defer cleanupFn()

	// Expected: health check timeout (no LLM credentials)
	if err == nil {
		t.Log("disposableContainer succeeded (unexpected but ok)")
	} else {
		t.Logf("disposableContainer error (expected): %v", err)
	}
	// The important thing: cleanup runs without panic
}

func TestDisposableContainerValidationError(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("Docker daemon not available")
	}

	s, cleanup := testServerWithDocker(t)
	defer cleanup()

	// Empty image → validation error
	entry := workers.Entry{
		Worker: &workers.Worker{
			Name: "bad-disp",
			Docker: &workers.DockerConfig{
				Image: "", // invalid
			},
		},
	}

	_, cleanupFn, err := s.disposableContainer(context.Background(), entry)
	defer cleanupFn()

	if err == nil {
		t.Fatal("expected validation error")
	}
}

func TestDisposableContainerBadEnv(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("Docker daemon not available")
	}

	s, cleanup := testServerWithDocker(t)
	defer cleanup()

	// Reserved env var → build env error
	entry := workers.Entry{
		Worker: &workers.Worker{
			Name: "badenv-disp",
			Docker: &workers.DockerConfig{
				Image: "mecha-worker:latest",
				Env:   map[string]string{"WORKER_BACKEND": "illegal"},
			},
		},
	}

	_, cleanupFn, err := s.disposableContainer(context.Background(), entry)
	defer cleanupFn()

	if err == nil {
		t.Fatal("expected env validation error")
	}
}

func TestDispatchDisposableFullPipeline(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("Docker daemon not available")
	}

	s, cleanup := testServerWithDocker(t)
	defer cleanup()

	ctx := context.Background()

	// Add disposable worker
	w := &workers.Worker{
		Name: "disp-pipeline",
		Docker: &workers.DockerConfig{
			Image:     "mecha-worker:latest",
			Lifecycle: "disposable",
		},
		Timeout: 2 * time.Minute,
	}
	if err := s.reg.Add(w); err != nil {
		t.Fatalf("Add worker: %v", err)
	}

	// Create task
	tk, err := s.tasks.Create(ctx, "disp-pipeline", "test prompt for disposable")
	if err != nil {
		t.Fatalf("Create task: %v", err)
	}

	entry, _ := s.reg.Get("disp-pipeline")

	// Dispatch — this creates a container, sends task, tears down
	s.dispatchDisposable(ctx, tk.ID, tk, entry)

	// Verify task completed
	tk, err = s.tasks.Get(ctx, tk.ID)
	if err != nil {
		t.Fatalf("Get task: %v", err)
	}
	if tk.State != tasks.StateCompleted && tk.State != tasks.StateFailed {
		t.Errorf("task state = %s, want completed or failed", tk.State)
	}
	t.Logf("disposable dispatch: state=%s", tk.State)
}

func TestWaitForDisposableHealthTimeout(t *testing.T) {
	if !dockerAvailable() {
		t.Skip("Docker daemon not available")
	}

	dock, err := workers.NewDockerClient("")
	if err != nil {
		t.Fatalf("NewDockerClient: %v", err)
	}
	defer dock.Close()

	ctx := context.Background()

	// Create a container that won't serve on 8080 (base image exits quickly)
	id, err := dock.Create(ctx, workers.ContainerCfg{
		Name:  "mecha-test-health-timeout",
		Image: "mecha-worker-base:latest",
		Env:   map[string]string{"HOME": "/tmp"},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	defer func() {
		rmCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		dock.Stop(rmCtx, id, 5*time.Second)
		dock.Remove(rmCtx, id)
	}()

	if err := dock.Start(ctx, id); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// waitForDisposableHealth should timeout
	_, err = waitForDisposableHealth(ctx, dock, id, 5*time.Second)
	if err == nil {
		t.Error("expected timeout error")
	}
}
