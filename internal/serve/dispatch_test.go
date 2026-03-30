package serve

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mecha.im/internal/store"
	"mecha.im/internal/task"
	"mecha.im/internal/worker"
)

func testDispatchServer(t *testing.T) (*Server, func()) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	reg, _ := worker.NewRegistry(db)
	tasks := task.NewStore(db)
	s := New(Config{Registry: reg, Tasks: tasks, Addr: "127.0.0.1:0"})
	return s, func() { db.Close() }
}

func TestDispatchLoop(t *testing.T) {
	s, cleanup := testDispatchServer(t)
	defer cleanup()

	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"output":"ok"}`))
	}))
	defer mock.Close()

	s.reg.Add(&worker.Worker{Name: "loop-w", Endpoint: mock.URL})
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
			if got.State == task.StateCompleted {
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

	s.reg.Add(&worker.Worker{Name: "busy-w", Endpoint: "http://x"})
	s.reg.Start("busy-w")
	s.reg.SetBusy("busy-w")

	tk, _ := s.tasks.Create(context.Background(), "busy-w", "test")
	s.dispatchTask(context.Background(), tk.ID)

	got, _ := s.tasks.Get(context.Background(), tk.ID)
	if got.State != task.StateFailed {
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

	s.reg.Add(&worker.Worker{Name: "rec-w", Endpoint: mock.URL})
	s.reg.Start("rec-w")

	// Create task and mark as dispatched (simulating recovery)
	tk, _ := s.tasks.Create(context.Background(), "rec-w", "test")
	s.tasks.SetDispatched(context.Background(), tk.ID)

	s.dispatchTask(context.Background(), tk.ID)

	got, _ := s.tasks.Get(context.Background(), tk.ID)
	if got.State != task.StateCompleted {
		t.Errorf("state = %q, want completed (recovered task)", got.State)
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

	result, err := s.sendTask(context.Background(), mock.URL, "t1", "prompt", time.Minute, "my-key")
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

	s.sendTask(context.Background(), mock.URL, "t1", "prompt", time.Minute, "")
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

	_, err := s.sendTask(context.Background(), mock.URL, "t1", "prompt", 100*time.Millisecond, "")
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

	_, err := s.sendTask(context.Background(), mock.URL, "t1", "prompt", time.Minute, "")
	if err == nil {
		t.Error("expected error for 500")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("error = %q, want mention of 500", err)
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
		{"context canceled", true},
		{"EOF", true},
		{"worker returned 500", false},
		{"task failed", false},
	}
	for _, tt := range tests {
		if got := isTransportError(fmt.Errorf("%s", tt.msg)); got != tt.want {
			t.Errorf("isTransportError(%q) = %v, want %v", tt.msg, got, tt.want)
		}
	}
}
