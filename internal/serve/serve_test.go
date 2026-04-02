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
	"mecha.im/internal/tasks"
	"mecha.im/internal/workers"
)

func testServer(t *testing.T) (*Server, func()) {
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

	s := New(Config{
		Registry: reg,
		Tasks:    taskStore,
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

	w := &workers.Worker{Name: "mock", Endpoint: mockWorker.URL}
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

	var created tasks.Task
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
	var got tasks.Task
	json.Unmarshal(rec2.Body.Bytes(), &got)
	if got.State != tasks.StateCompleted {
		t.Errorf("state = %q, want completed", got.State)
	}
	if !strings.Contains(got.Result, "hello") {
		t.Errorf("result = %q", got.Result)
	}
}

func testServerWithKey(t *testing.T, key string) (*Server, func()) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	s := New(Config{Registry: reg, Tasks: taskStore, Addr: "127.0.0.1:0", APIKey: key})
	return s, func() { db.Close() }
}

func TestAuthMiddleware(t *testing.T) {
	s, cleanup := testServerWithKey(t, "secret-123")
	defer cleanup()

	// No auth → 401
	req := httptest.NewRequest("POST", "/task", strings.NewReader(`{"prompt":"x","worker":"w"}`))
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("no auth: status = %d, want 401", rec.Code)
	}

	// Wrong key → 401
	req2 := httptest.NewRequest("POST", "/task", strings.NewReader(`{"prompt":"x","worker":"w"}`))
	req2.Header.Set("Authorization", "Bearer wrong")
	rec2 := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusUnauthorized {
		t.Errorf("wrong key: status = %d, want 401", rec2.Code)
	}

	// Correct Bearer → passes through (400 because no worker, not 401)
	req3 := httptest.NewRequest("POST", "/task", strings.NewReader(`{"prompt":"x","worker":"w"}`))
	req3.Header.Set("Authorization", "Bearer secret-123")
	rec3 := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec3, req3)
	if rec3.Code == http.StatusUnauthorized {
		t.Error("correct Bearer should not be 401")
	}

	// Correct X-API-Key → passes through
	req4 := httptest.NewRequest("POST", "/task", strings.NewReader(`{"prompt":"x","worker":"w"}`))
	req4.Header.Set("X-API-Key", "secret-123")
	rec4 := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec4, req4)
	if rec4.Code == http.StatusUnauthorized {
		t.Error("correct X-API-Key should not be 401")
	}

	// Health exempt from auth
	req5 := httptest.NewRequest("GET", "/health", nil)
	rec5 := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec5, req5)
	if rec5.Code != 200 {
		t.Errorf("health should be 200 without auth, got %d", rec5.Code)
	}
}

func TestListTasks(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	// Empty list
	req := httptest.NewRequest("GET", "/tasks", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}

	// Create tasks and list with filter
	s.tasks.Create(context.Background(), "w", "p1")
	t2, _ := s.tasks.Create(context.Background(), "w", "p2")
	s.tasks.SetDispatched(context.Background(), t2.ID)

	req2 := httptest.NewRequest("GET", "/tasks?state=pending", nil)
	rec2 := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec2, req2)
	var taskList []tasks.Task
	json.Unmarshal(rec2.Body.Bytes(), &taskList)
	if len(taskList) != 1 {
		t.Errorf("pending tasks = %d, want 1", len(taskList))
	}
}

func TestGetTaskNotFound(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	req := httptest.NewRequest("GET", "/task/nonexistent", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != 404 {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestDispatchToOfflineWorker(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	s.reg.Add(&workers.Worker{Name: "offline-w", Endpoint: "http://x"})
	// Worker is offline — don't start it

	tk, _ := s.tasks.Create(context.Background(), "offline-w", "test")
	s.dispatchTask(context.Background(), tk.ID)

	got, _ := s.tasks.Get(context.Background(), tk.ID)
	if got.State != tasks.StateFailed {
		t.Errorf("state = %q, want failed", got.State)
	}
	if !strings.Contains(got.ErrorMsg, "not available") {
		t.Errorf("error = %q, want 'not available'", got.ErrorMsg)
	}
}

func TestDispatchWorkerReturnsError(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`{"error":"internal"}`))
	}))
	defer mock.Close()

	s.reg.Add(&workers.Worker{Name: "err-w", Endpoint: mock.URL})
	s.reg.Start("err-w")

	tk, _ := s.tasks.Create(context.Background(), "err-w", "test")
	s.dispatchTask(context.Background(), tk.ID)

	got, _ := s.tasks.Get(context.Background(), tk.ID)
	if got.State != tasks.StateFailed {
		t.Errorf("state = %q, want failed", got.State)
	}
}

func TestNilSourcesWebhook404(t *testing.T) {
	// Server with nil Sources/Events should not register webhook routes
	s, cleanup := testServer(t)
	defer cleanup()

	req := httptest.NewRequest("POST", "/webhook/github", strings.NewReader("{}"))
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	// Should be 405 or 404 since routes are not registered
	if rec.Code == http.StatusOK || rec.Code == http.StatusAccepted {
		t.Errorf("webhook with nil sources should not succeed, got %d", rec.Code)
	}
}

func TestNilSourcesEvents404(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	req := httptest.NewRequest("GET", "/events", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code == http.StatusOK {
		t.Errorf("events with nil store should not return 200, got %d", rec.Code)
	}
}

func TestListWorkers(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	s.reg.Add(&workers.Worker{Name: "a", Endpoint: "http://x"})
	s.reg.Add(&workers.Worker{Name: "b", Endpoint: "http://y"})

	req := httptest.NewRequest("GET", "/workers", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	var entries []workers.Entry
	json.Unmarshal(rec.Body.Bytes(), &entries)
	if len(entries) != 2 {
		t.Errorf("got %d workers", len(entries))
	}
}
