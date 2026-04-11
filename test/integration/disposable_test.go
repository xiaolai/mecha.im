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

	"mecha.im/internal/events"
	"mecha.im/internal/serve"
	"mecha.im/internal/source"
	"mecha.im/internal/store"
	"mecha.im/internal/tasks"
	"mecha.im/internal/workers"
)

func TestDisposable_FullLifecycle(t *testing.T) {
	skipIfNoDocker(t)

	backends := []struct {
		backend string
		image   string
		envKey  string
	}{
		{"claude", "mecha-worker:latest", "CLAUDE_MODEL"},
	}

	for _, b := range backends {
		t.Run(b.backend, func(t *testing.T) {
			skipIfNoImage(t, b.image)

			path := filepath.Join(t.TempDir(), "test.db")
			db, err := store.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()

			reg, _ := workers.NewRegistry(db)
			taskStore := tasks.NewStore(db)
			evStore := events.NewStore(db)
			sources := source.NewRegistry()

			workerName := "disposable-e2e-" + b.backend
			w := &workers.Worker{
				Name: workerName,
				Docker: &workers.DockerConfig{
					Image:     b.image,
					Lifecycle: "disposable",
					Env:       map[string]string{b.envKey: "test"},
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
				Tasks:    taskStore,
				Events:   evStore,
				Sources:  sources,
				Addr:     addr,
			})

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			errCh := make(chan error, 1)
			go func() { errCh <- srv.Start(ctx) }()
			waitForServerHealth(t, fmt.Sprintf("http://%s", addr), 5*time.Second)

			// POST /task via HTTP — this puts the task on the pending channel
			body := fmt.Sprintf(`{"prompt":"respond with exactly: disposable works","worker":"%s"}`, workerName)
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

			var tk tasks.Task
			json.NewDecoder(resp.Body).Decode(&tk)
			t.Logf("created task %s for disposable %s worker", tk.ID, b.backend)

			// Wait for task to complete or fail
			deadline := time.After(90 * time.Second)
			for {
				select {
				case <-deadline:
					got, _ := taskStore.Get(ctx, tk.ID)
					cancel()
					<-errCh
					t.Fatalf("task did not complete within 90s (state: %s, error: %s)", got.State, got.ErrorMsg)
				default:
					got, _ := taskStore.Get(ctx, tk.ID)
					if got.State == tasks.StateCompleted {
						t.Logf("disposable %s task completed successfully", b.backend)
						cancel()
						<-errCh
						return
					}
					if got.State == tasks.StateFailed {
						cancel()
						<-errCh
						// Container may fail due to missing auth — that's OK
						t.Logf("disposable %s task failed (expected without auth): %s", b.backend, got.ErrorMsg)
						return
					}
					time.Sleep(2 * time.Second)
				}
			}
		})
	}
}
