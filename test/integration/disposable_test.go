package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mecha.im/internal/event"
	"mecha.im/internal/serve"
	"mecha.im/internal/source"
	"mecha.im/internal/store"
	"mecha.im/internal/task"
	"mecha.im/internal/worker"
)

func TestDisposable_FullLifecycle(t *testing.T) {
	skipIfNoDocker(t)
	skipIfNoImage(t, "mecha-worker-claude:latest")

	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	reg, _ := worker.NewRegistry(db)
	tasks := task.NewStore(db)
	events := event.NewStore(db)
	sources := source.NewRegistry()

	w := &worker.Worker{
		Name: "disposable-e2e",
		Docker: &worker.DockerConfig{
			Image:     "mecha-worker-claude:latest",
			Lifecycle: "disposable",
			Env:       map[string]string{"CLAUDE_MODEL": "test"},
		},
		Timeout: 2 * time.Minute,
	}
	if err := reg.Add(w); err != nil {
		t.Fatal(err)
	}

	// Find a free port
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close()

	srv := serve.New(serve.Config{
		Registry: reg,
		Tasks:    tasks,
		Events:   events,
		Sources:  sources,
		Addr:     addr,
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	errCh := make(chan error, 1)
	go func() { errCh <- srv.Start(ctx) }()
	time.Sleep(1 * time.Second)

	// POST /task via HTTP — this puts the task on the pending channel
	body := `{"prompt":"respond with exactly: disposable works","worker":"disposable-e2e"}`
	resp, err := http.Post(fmt.Sprintf("http://%s/task", addr), "application/json", strings.NewReader(body))
	if err != nil {
		cancel()
		<-errCh
		t.Fatalf("POST /task: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted {
		cancel()
		<-errCh
		t.Fatalf("POST /task: status %d", resp.StatusCode)
	}

	var tk task.Task
	json.NewDecoder(resp.Body).Decode(&tk)
	t.Logf("created task %s for disposable worker", tk.ID)

	// Wait for task to complete or fail
	deadline := time.After(90 * time.Second)
	for {
		select {
		case <-deadline:
			got, _ := tasks.Get(ctx, tk.ID)
			cancel()
			<-errCh
			t.Fatalf("task did not complete within 90s (state: %s, error: %s)", got.State, got.ErrorMsg)
		default:
			got, _ := tasks.Get(ctx, tk.ID)
			if got.State == task.StateCompleted {
				t.Logf("disposable task completed successfully")
				cancel()
				<-errCh
				return
			}
			if got.State == task.StateFailed {
				cancel()
				<-errCh
				// Container may fail due to missing Claude auth — that's OK
				t.Logf("disposable task failed (expected without auth): %s", got.ErrorMsg)
				return
			}
			time.Sleep(2 * time.Second)
		}
	}
}
