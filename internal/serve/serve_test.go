package serve

import (
	"context"
	"encoding/json"
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

func testServer(t *testing.T) (*Server, func()) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	reg, err := worker.NewRegistry(db)
	if err != nil {
		t.Fatal(err)
	}
	tasks := task.NewStore(db)

	s := New(Config{
		Registry: reg,
		Tasks:    tasks,
		Addr:     "127.0.0.1:0",
	})
	return s, func() { db.Close() }
}

func TestHealthEndpoint(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("status = %d", w.Code)
	}
}

func TestPostTaskNoWorkers(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	body := `{"prompt":"test"}`
	req := httptest.NewRequest("POST", "/task", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", w.Code)
	}
}

func TestPostTaskMissingPrompt(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	body := `{"worker":"w"}`
	req := httptest.NewRequest("POST", "/task", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

func TestPostTaskAndGet(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	// Add a mock worker with a fake endpoint
	mockWorker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"output":"hello","metadata":{"exit_code":0}}`))
	}))
	defer mockWorker.Close()

	w := &worker.Worker{Name: "mock", Endpoint: mockWorker.URL}
	if err := s.reg.Add(w); err != nil {
		t.Fatal(err)
	}
	if err := s.reg.Start("mock"); err != nil {
		t.Fatal(err)
	}

	// Post task
	body := `{"prompt":"test","worker":"mock"}`
	req := httptest.NewRequest("POST", "/task", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("post status = %d: %s", rec.Code, rec.Body.String())
	}

	var created task.Task
	json.Unmarshal(rec.Body.Bytes(), &created)
	if created.ID == "" {
		t.Fatal("expected task ID")
	}

	// Dispatch runs async — process one task
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	select {
	case taskID := <-s.pending:
		s.dispatchTask(ctx, taskID)
	case <-ctx.Done():
		t.Fatal("no task in pending channel")
	}

	// Get task — should be completed
	req2 := httptest.NewRequest("GET", "/task/"+created.ID, nil)
	rec2 := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec2, req2)

	if rec2.Code != 200 {
		t.Fatalf("get status = %d", rec2.Code)
	}
	var got task.Task
	json.Unmarshal(rec2.Body.Bytes(), &got)
	if got.State != task.StateCompleted {
		t.Errorf("state = %q, want completed", got.State)
	}
	if !strings.Contains(got.Result, "hello") {
		t.Errorf("result = %q", got.Result)
	}
}

func TestListWorkers(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	s.reg.Add(&worker.Worker{Name: "a", Endpoint: "http://x"})
	s.reg.Add(&worker.Worker{Name: "b", Endpoint: "http://y"})

	req := httptest.NewRequest("GET", "/workers", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	var entries []worker.Entry
	json.Unmarshal(rec.Body.Bytes(), &entries)
	if len(entries) != 2 {
		t.Errorf("got %d workers", len(entries))
	}
}
