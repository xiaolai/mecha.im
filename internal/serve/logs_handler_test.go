package serve

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"mecha.im/internal/logs"
	"mecha.im/internal/store"
	"mecha.im/internal/tasks"
	"mecha.im/internal/workers"
)

func testServerWithLogs(t *testing.T) (*Server, func()) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	logStore := logs.NewStore(db, nil)
	s := New(Config{
		Registry: reg,
		Tasks:    taskStore,
		Logs:     logStore,
		Addr:     "127.0.0.1:0",
	})
	return s, func() { db.Close() }
}

func TestHandleLogsEmpty(t *testing.T) {
	s, cleanup := testServerWithLogs(t)
	defer cleanup()

	req := httptest.NewRequest("GET", "/logs", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var entries []any
	if err := json.Unmarshal(rec.Body.Bytes(), &entries); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("expected empty list, got %d entries", len(entries))
	}
}

func TestHandleLogsWithEntries(t *testing.T) {
	s, cleanup := testServerWithLogs(t)
	defer cleanup()

	// Record two entries
	s.record(logs.Entry{TraceID: "trace1", EventID: "ev1", Worker: "w1", Action: logs.EventReceived, Outcome: logs.OK})
	s.record(logs.Entry{TraceID: "trace2", EventID: "ev2", Worker: "w2", Action: logs.EventMatched, Outcome: logs.OK})

	req := httptest.NewRequest("GET", "/logs", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var entries []logs.Entry
	if err := json.Unmarshal(rec.Body.Bytes(), &entries); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(entries) < 2 {
		t.Errorf("expected >= 2 entries, got %d", len(entries))
	}
}

func TestHandleLogsFilterByWorker(t *testing.T) {
	s, cleanup := testServerWithLogs(t)
	defer cleanup()

	s.record(logs.Entry{TraceID: "t1", Worker: "alpha", Action: logs.EventReceived, Outcome: logs.OK})
	s.record(logs.Entry{TraceID: "t2", Worker: "beta", Action: logs.EventReceived, Outcome: logs.OK})

	req := httptest.NewRequest("GET", "/logs?worker=alpha", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var entries []logs.Entry
	json.Unmarshal(rec.Body.Bytes(), &entries)
	for _, e := range entries {
		if e.Worker != "alpha" {
			t.Errorf("got entry for worker %q, want alpha only", e.Worker)
		}
	}
}

func TestHandleLogsLimitParam(t *testing.T) {
	s, cleanup := testServerWithLogs(t)
	defer cleanup()

	for i := 0; i < 5; i++ {
		s.record(logs.Entry{TraceID: "t", Worker: "w", Action: logs.EventReceived, Outcome: logs.OK})
	}

	req := httptest.NewRequest("GET", "/logs?limit=2", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var entries []logs.Entry
	json.Unmarshal(rec.Body.Bytes(), &entries)
	if len(entries) > 2 {
		t.Errorf("got %d entries with limit=2", len(entries))
	}
}

func TestHandleLogsNotRegisteredWithoutLogStore(t *testing.T) {
	// Server without Logs config should not have /logs route registered.
	s, cleanup := testServer(t)
	defer cleanup()

	req := httptest.NewRequest("GET", "/logs", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)

	// Route not registered — should 404 or 405, not 200
	if rec.Code == http.StatusOK {
		t.Errorf("/logs should not be 200 when no log store is configured")
	}
}
