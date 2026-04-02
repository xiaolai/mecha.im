package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"mecha.im/internal/event"
	"mecha.im/internal/serve"
	"mecha.im/internal/store"
	"mecha.im/internal/task"
	"mecha.im/internal/worker"
)

func TestRetry_TransportErrorRecovers(t *testing.T) {
	// Mock worker that fails with connection reset on first attempt,
	// then succeeds on the 2nd.
	var attempts atomic.Int32
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		if r.URL.Path == "/task" && r.Method == http.MethodPost {
			n := attempts.Add(1)
			if n <= 1 {
				// Simulate transport error: hijack and close connection
				hj, ok := w.(http.Hijacker)
				if ok {
					conn, _, err := hj.Hijack()
					if err == nil && conn != nil {
						conn.Close()
						return
					}
				}
				// Fallback: return 500 (not a transport error, but covers edge)
				w.WriteHeader(500)
				return
			}
			// 2nd+ attempt: succeed
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"output":"recovered after retries"}`))
			return
		}
		w.WriteHeader(404)
	}))
	defer mock.Close()

	// Build server manually to access the DB for retry acceleration and
	// the registry for worker state management.
	dbPath := tempDBPath(t)
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}

	reg, err := worker.NewRegistry(db)
	if err != nil {
		t.Fatalf("create registry: %v", err)
	}
	w := &worker.Worker{
		Name:     "retry-worker",
		Endpoint: mock.URL,
		Timeout:  10 * time.Second,
	}
	if err := reg.Add(w); err != nil {
		t.Fatalf("add worker: %v", err)
	}
	if err := reg.Start(w.Name); err != nil {
		t.Fatalf("start worker: %v", err)
	}

	tasks := task.NewStore(db)
	events := event.NewStore(db)

	port := findFreePort(t)
	addr := fmt.Sprintf("127.0.0.1:%d", port)

	srv := serve.New(serve.Config{
		Registry: reg,
		Tasks:    tasks,
		Events:   events,
		Addr:     addr,
	})

	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() { errCh <- srv.Start(ctx) }()

	serverURL := fmt.Sprintf("http://%s", addr)
	waitForServerHealth(t, serverURL, 5*time.Second)
	defer func() {
		cancel()
		<-errCh
		db.Close()
	}()

	// Submit task.
	body, status := apiPost(t, serverURL, "/task", map[string]string{
		"prompt": "test retry recovery",
		"worker": "retry-worker",
	})
	if status != http.StatusAccepted {
		t.Fatalf("POST /task status = %d, body = %s", status, body)
	}

	var resp map[string]any
	json.Unmarshal(body, &resp)
	taskID, _ := resp["id"].(string)
	if taskID == "" {
		t.Fatalf("no task ID in response: %s", body)
	}

	// Wait for the first dispatch attempt to fail and put the task into
	// pending state with attempts > 0.
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		tsk, getErr := tasks.Get(ctx, taskID)
		if getErr == nil && tsk.State == task.StatePending && tsk.Attempts > 0 {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	// After a transport error, dispatch sets the worker to "error" state.
	// Simulate the worker recovering (e.g., coming back online) by
	// transitioning it back to online. In production this would happen
	// through a health-check reconciliation loop or manual restart.
	// The registry requires error→offline→online transitions.
	if stopErr := reg.Stop("retry-worker"); stopErr != nil {
		t.Logf("stop worker: %v (may already be in correct state)", stopErr)
	}
	if startErr := reg.Start("retry-worker"); startErr != nil {
		t.Logf("start worker: %v (may already be in correct state)", startErr)
	}

	// Accelerate retry: set next_retry_at to the past so the retry
	// scan picks it up on the next tick (30s interval).
	_, err = db.Exec(
		`UPDATE tasks SET next_retry_at = ? WHERE id = ?`,
		time.Now().Add(-1*time.Minute).Unix(), taskID,
	)
	if err != nil {
		t.Fatalf("accelerate retry: %v", err)
	}

	// Wait for the retry loop (30s interval) to pick up and re-dispatch.
	result := pollTaskState(t, serverURL, taskID, 90*time.Second)
	state, _ := result["state"].(string)

	if state != "completed" {
		t.Fatalf("task state = %q, want completed; result = %v", state, result)
	}

	// Verify that the mock worker was hit more than once.
	finalAttempts := attempts.Load()
	if finalAttempts < 2 {
		t.Errorf("worker attempts = %d, want >= 2", finalAttempts)
	}
}
