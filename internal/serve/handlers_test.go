package serve

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"mecha.im/internal/workers"
)

func TestPostTaskAutoSelectRoundRobin(t *testing.T) {
	workerRoundRobin.Store(0) // reset shared atomic for test isolation
	s, cleanup := testServer(t)
	defer cleanup()

	s.reg.Add(&workers.Worker{Name: "aa", Endpoint: "http://a"})
	s.reg.Add(&workers.Worker{Name: "bb", Endpoint: "http://b"})
	s.reg.Start("aa")
	s.reg.Start("bb")

	// Post two tasks — should round-robin between aa and bb
	names := map[string]int{}
	for i := 0; i < 4; i++ {
		req := httptest.NewRequest("POST", "/task", strings.NewReader(`{"prompt":"test"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		s.httpSrv.Handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusAccepted {
			t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
		}
		// Drain the pending channel
		select {
		case <-s.pending:
		default:
		}
	}
	// Check that tasks went to different workers
	tasks, _ := s.tasks.List(context.Background(), "")
	for _, tk := range tasks {
		names[tk.WorkerName]++
	}
	if names["aa"] == 0 || names["bb"] == 0 {
		t.Errorf("round-robin failed: aa=%d bb=%d", names["aa"], names["bb"])
	}
}

func TestPostTaskQueueFull(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	s.reg.Add(&workers.Worker{Name: "w", Endpoint: "http://x"})
	s.reg.Start("w")

	// Fill the channel
	for i := 0; i < 256; i++ {
		s.pending <- "dummy"
	}

	req := httptest.NewRequest("POST", "/task", strings.NewReader(`{"prompt":"test","worker":"w"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("status = %d, want 429", rec.Code)
	}

	// Drain
	for len(s.pending) > 0 {
		<-s.pending
	}
}

func TestPostTaskInvalidJSON(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	req := httptest.NewRequest("POST", "/task", strings.NewReader(`{bad json`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestGetTaskNotFoundByID(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	req := httptest.NewRequest("GET", "/task/abcdef1234567890", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != 404 {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestGetTaskSuccess(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	tk, _ := s.tasks.Create(context.Background(), "w", "hello")
	req := httptest.NewRequest("GET", "/task/"+tk.ID, nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "hello") {
		t.Errorf("body = %q, want prompt in response", rec.Body.String())
	}
}

func TestListTasksWithResults(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	s.tasks.Create(context.Background(), "w", "p1")
	s.tasks.Create(context.Background(), "w", "p2")

	req := httptest.NewRequest("GET", "/tasks", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Errorf("status = %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "p1") || !strings.Contains(rec.Body.String(), "p2") {
		t.Errorf("missing tasks in response: %s", rec.Body.String())
	}
}

func TestListTasksEmpty(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	req := httptest.NewRequest("GET", "/tasks", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	if strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Errorf("body = %q, want []", rec.Body.String())
	}
}
