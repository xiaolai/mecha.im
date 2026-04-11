package serve

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mecha.im/internal/store"
	"mecha.im/internal/tasks"
	"mecha.im/internal/workers"
)

func testDispatchServer(t *testing.T) (*Server, func()) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	s := New(Config{Registry: reg, Tasks: taskStore, Addr: "127.0.0.1:0"})
	return s, func() { db.Close() }
}

func TestDispatchLoop(t *testing.T) {
	s, cleanup := testDispatchServer(t)
	defer cleanup()

	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"output":"ok"}`))
	}))
	defer mock.Close()

	s.reg.Add(&workers.Worker{Name: "loop-w", Endpoint: mock.URL})
	s.reg.Start("loop-w")

	tk, _ := s.tasks.Create(context.Background(), "loop-w", "test")

	ctx, cancel := context.WithCancel(context.Background())
	go s.dispatchLoop(ctx)
	s.pending <- tk.ID

	// Wait for dispatch to complete
	deadline := time.After(5 * time.Second)
	for {
		select {
		case <-deadline:
			cancel()
			t.Fatal("dispatch timed out")
		default:
			got, _ := s.tasks.Get(context.Background(), tk.ID)
			if got.State == tasks.StateCompleted {
				cancel()
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
}

func TestDispatchBusyWorkerRejected(t *testing.T) {
	s, cleanup := testDispatchServer(t)
	defer cleanup()

	s.reg.Add(&workers.Worker{Name: "busy-w", Endpoint: "http://x"})
	s.reg.Start("busy-w")
	s.reg.SetBusy("busy-w")

	tk, _ := s.tasks.Create(context.Background(), "busy-w", "test")
	s.dispatchTask(context.Background(), tk.ID)

	got, _ := s.tasks.Get(context.Background(), tk.ID)
	if got.State != tasks.StateFailed {
		t.Errorf("state = %q, want failed (worker busy)", got.State)
	}
}

func TestDispatchRecoveredTask(t *testing.T) {
	s, cleanup := testDispatchServer(t)
	defer cleanup()

	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"output":"recovered"}`))
	}))
	defer mock.Close()

	s.reg.Add(&workers.Worker{Name: "rec-w", Endpoint: mock.URL})
	s.reg.Start("rec-w")

	// Create task and mark as dispatched (simulating recovery)
	tk, _ := s.tasks.Create(context.Background(), "rec-w", "test")
	s.tasks.SetDispatched(context.Background(), tk.ID)

	s.dispatchTask(context.Background(), tk.ID)

	got, _ := s.tasks.Get(context.Background(), tk.ID)
	if got.State != tasks.StateCompleted {
		t.Errorf("state = %q, want completed (recovered task)", got.State)
	}
}

func TestSendTaskForwardsContext(t *testing.T) {
	var gotBody []byte
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		w.Write([]byte(`{"output":"ok"}`))
	}))
	defer mock.Close()

	s, cleanup := testDispatchServer(t)
	defer cleanup()

	taskCtx := `{"source":"github","actor":"alice","number":42}`
	_, err := s.sendTask(context.Background(), mock.URL, "t1", "hello", taskCtx, time.Minute, "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(gotBody), `"context"`) {
		t.Errorf("worker body missing context field: %s", gotBody)
	}
	if !strings.Contains(string(gotBody), `"alice"`) {
		t.Errorf("worker body missing context content: %s", gotBody)
	}
}

func TestSendTaskWithAPIKey(t *testing.T) {
	var gotAuth string
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Write([]byte(`{"output":"ok"}`))
	}))
	defer mock.Close()

	s, cleanup := testDispatchServer(t)
	defer cleanup()

	result, err := s.sendTask(context.Background(), mock.URL, "t1", "prompt", "", time.Minute, "my-key")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result, "ok") {
		t.Errorf("result = %q", result)
	}
	if gotAuth != "Bearer my-key" {
		t.Errorf("auth = %q, want Bearer my-key", gotAuth)
	}
}

func TestSendTaskNoAPIKey(t *testing.T) {
	var gotAuth string
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Write([]byte(`{"output":"ok"}`))
	}))
	defer mock.Close()

	s, cleanup := testDispatchServer(t)
	defer cleanup()

	s.sendTask(context.Background(), mock.URL, "t1", "prompt", "", time.Minute, "")
	if gotAuth != "" {
		t.Errorf("auth = %q, want empty (no key)", gotAuth)
	}
}

func TestSendTaskTimeout(t *testing.T) {
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(5 * time.Second)
	}))
	defer mock.Close()

	s, cleanup := testDispatchServer(t)
	defer cleanup()

	_, err := s.sendTask(context.Background(), mock.URL, "t1", "prompt", "", 100*time.Millisecond, "")
	if err == nil {
		t.Error("expected timeout error")
	}
}

func TestSendTaskWorker500(t *testing.T) {
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte("internal error"))
	}))
	defer mock.Close()

	s, cleanup := testDispatchServer(t)
	defer cleanup()

	_, err := s.sendTask(context.Background(), mock.URL, "t1", "prompt", "", time.Minute, "")
	if err == nil {
		t.Error("expected error for 500")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("error = %q, want mention of 500", err)
	}
}

func TestDispatchWorkerNoEndpoint(t *testing.T) {
	s, cleanup := testDispatchServer(t)
	defer cleanup()

	// Worker with no endpoint
	s.reg.Add(&workers.Worker{Name: "no-ep"})
	s.reg.Start("no-ep")

	tk, _ := s.tasks.Create(context.Background(), "no-ep", "test")
	s.dispatchTask(context.Background(), tk.ID)

	got, _ := s.tasks.Get(context.Background(), tk.ID)
	if got.State != tasks.StateFailed {
		t.Errorf("state = %q, want failed (no endpoint)", got.State)
	}
}

func TestDispatchWorkerNotFound(t *testing.T) {
	s, cleanup := testDispatchServer(t)
	defer cleanup()

	tk, _ := s.tasks.Create(context.Background(), "ghost", "test")
	s.dispatchTask(context.Background(), tk.ID)

	got, _ := s.tasks.Get(context.Background(), tk.ID)
	if got.State != tasks.StateFailed {
		t.Errorf("state = %q, want failed", got.State)
	}
}

func TestDispatchTransportErrorSetsWorkerError(t *testing.T) {
	s, cleanup := testDispatchServer(t)
	defer cleanup()

	// Worker endpoint that immediately closes connection
	s.reg.Add(&workers.Worker{Name: "dead-w", Endpoint: "http://127.0.0.1:1"})
	s.reg.Start("dead-w")

	tk, _ := s.tasks.Create(context.Background(), "dead-w", "test")
	s.dispatchTask(context.Background(), tk.ID)

	// Worker should be in error state (not online)
	entry, _ := s.reg.Get("dead-w")
	if entry.State != workers.StateError {
		t.Errorf("worker state = %q, want error", entry.State)
	}
}

func TestDispatchTaskNotFound(t *testing.T) {
	s, cleanup := testDispatchServer(t)
	defer cleanup()
	// Should not panic — just log
	s.dispatchTask(context.Background(), "nonexistent-task-id")
}

func TestDispatchTaskCompleteFailureStopsEventCompletion(t *testing.T) {
	s, cleanup := testDispatchServer(t)

	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"output":"ok"}`))
	}))
	defer mock.Close()

	s.reg.Add(&workers.Worker{Name: "db-fail-w", Endpoint: mock.URL})
	s.reg.Start("db-fail-w")

	tk, _ := s.tasks.Create(context.Background(), "db-fail-w", "test")

	// Close DB to force taskStore.Complete to fail
	cleanup()

	s.dispatchTask(context.Background(), tk.ID)

	// Worker should be restored to online (not stuck in busy)
	entry, ok := s.reg.Get("db-fail-w")
	if ok && entry.State == workers.StateBusy {
		t.Error("worker should not be stuck in busy after DB failure")
	}
}

func TestIsTransportError(t *testing.T) {
	tests := []struct {
		msg  string
		want bool
	}{
		{"connection refused", true},
		{"no such host", true},
		{"deadline exceeded", true},
		{"context canceled", false},
		{"EOF", false},
		{"connection reset", true},
		{"worker returned 500", true},
		{"worker returned 502: bad gateway", true},
		{"task failed", false},
	}
	for _, tt := range tests {
		if got := isTransportError(fmt.Errorf("%s", tt.msg)); got != tt.want {
			t.Errorf("isTransportError(%q) = %v, want %v", tt.msg, got, tt.want)
		}
	}
}

func TestIsUniqueViolation(t *testing.T) {
	tests := []struct {
		msg  string
		want bool
	}{
		{"UNIQUE constraint failed: events.delivery_id", true},
		{"unique constraint failed", true},
		{"constraint failed: events.delivery_id", true},
		{"sqlite error code 2067", true},
		{"insert failed: some other reason", false},
		{"duplicate key", false},
	}
	for _, tt := range tests {
		if got := isUniqueViolation(fmt.Errorf("%s", tt.msg)); got != tt.want {
			t.Errorf("isUniqueViolation(%q) = %v, want %v", tt.msg, got, tt.want)
		}
	}
}
