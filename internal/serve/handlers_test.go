package serve

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"mecha.im/internal/worker"
)

func TestPostTaskAutoSelectRoundRobin(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	s.reg.Add(&worker.Worker{Name: "aa", Endpoint: "http://a"})
	s.reg.Add(&worker.Worker{Name: "bb", Endpoint: "http://b"})
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

	s.reg.Add(&worker.Worker{Name: "w", Endpoint: "http://x"})
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

func TestGetTaskDBError(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	// Create task then get it (happy path already tested)
	// Test with valid ID format but not in DB → 404
	req := httptest.NewRequest("GET", "/task/abcdef1234567890", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != 404 {
		t.Errorf("status = %d, want 404", rec.Code)
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
