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

	"mecha.im/internal/events"
	"mecha.im/internal/policies"
	"mecha.im/internal/source"
	"mecha.im/internal/store"
	"mecha.im/internal/tasks"
	"mecha.im/internal/workers"
)

// Suppress unused import warnings
var _ = events.NewStore
var _ = source.NewRegistry
var _ policies.Filter = &policies.AllowAll{}

// --- withTraceID ---

func TestWithTraceID(t *testing.T) {
	ctx := withTraceID(context.Background())
	id := traceID(ctx)
	if id == "none" {
		t.Error("expected a trace ID, got 'none'")
	}
	if len(id) != 16 { // 8 bytes = 16 hex chars
		t.Errorf("trace ID length = %d, want 16", len(id))
	}
}

func TestTraceIDMissing(t *testing.T) {
	id := traceID(context.Background())
	if id != "none" {
		t.Errorf("traceID on empty context = %q, want 'none'", id)
	}
}

// --- randomSuffix ---

func TestRandomSuffixMax(t *testing.T) {
	s := randomSuffix()
	if len(s) != 16 { // 8 bytes = 16 hex chars
		t.Errorf("randomSuffix() length = %d, want 16", len(s))
	}
	// Verify it's hex
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			t.Errorf("non-hex char in suffix: %c", c)
			break
		}
	}
	// Two calls should produce different results
	s2 := randomSuffix()
	if s == s2 {
		t.Error("two calls to randomSuffix returned same value")
	}
}

// --- handleGetTask: internal error (not "not found") ---

func TestHandleGetTaskInternalError(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}

	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	s := New(Config{Registry: reg, Tasks: taskStore, Addr: "127.0.0.1:0"})

	// Close DB to trigger internal error (not "not found")
	db.Close()

	req := httptest.NewRequest("GET", "/task/some-id", nil)
	req.SetPathValue("id", "some-id")
	w := httptest.NewRecorder()
	s.handleGetTask(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", w.Code)
	}
}

// --- handleGetTask: not found ---

func TestHandleGetTaskNotFound(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	s := New(Config{Registry: reg, Tasks: taskStore, Addr: "127.0.0.1:0"})

	req := httptest.NewRequest("GET", "/task/nonexistent", nil)
	req.SetPathValue("id", "nonexistent")
	w := httptest.NewRecorder()
	s.handleGetTask(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", w.Code)
	}
}

// --- handleGetTask: missing id ---

func TestHandleGetTaskMissingID(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	s := New(Config{Registry: reg, Tasks: taskStore, Addr: "127.0.0.1:0"})

	req := httptest.NewRequest("GET", "/task/", nil)
	req.SetPathValue("id", "")
	w := httptest.NewRecorder()
	s.handleGetTask(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

// --- getWorkerPolicy: worker not found ---

func TestGetWorkerPolicyNotFound(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	s := New(Config{Registry: reg, Tasks: taskStore, Addr: "127.0.0.1:0"})

	f := s.getWorkerPolicy("nonexistent-worker")
	// Should return AllowAll for missing worker
	_, ok := f.(*policies.AllowAll)
	if !ok {
		t.Errorf("expected AllowAll for missing worker, got %T", f)
	}
}

// --- getWorkerPolicy: nil policy ---

func TestGetWorkerPolicyNilPolicy(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	s := New(Config{Registry: reg, Tasks: taskStore, Addr: "127.0.0.1:0"})

	// Add a worker with nil policy
	w := &workers.Worker{Name: "no-policy", Endpoint: "http://localhost:8080"}
	reg.Add(w)

	f := s.getWorkerPolicy("no-policy")
	_, ok := f.(*policies.AllowAll)
	if !ok {
		t.Errorf("expected AllowAll for nil policy, got %T", f)
	}
}

// --- scanPending: DB error ---

func TestScanPendingDBErrorMax(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}

	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	s := New(Config{Registry: reg, Tasks: taskStore, Addr: "127.0.0.1:0"})

	db.Close()

	// Should not panic, just log the error
	s.scanPending(context.Background())
}

// --- scanPending: queue full ---

func TestScanPendingQueueFullMax(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	s := New(Config{Registry: reg, Tasks: taskStore, Addr: "127.0.0.1:0"})

	ctx := context.Background()

	// Create a task
	tk, _ := taskStore.Create(ctx, "w", "prompt")
	_ = tk

	// Fill the queue
	for i := 0; i < 256; i++ {
		s.pending <- "dummy"
	}

	// scanPending should not panic when queue is full
	s.scanPending(ctx)

	// Drain
	for len(s.pending) > 0 {
		<-s.pending
	}
}

// --- scanRetries: DB error ---

func TestScanRetriesDBErrorMax(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}

	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	s := New(Config{Registry: reg, Tasks: taskStore, Addr: "127.0.0.1:0"})

	db.Close()

	// Should not panic
	s.scanRetries(context.Background())
}

// --- readJSON: invalid body ---

func TestReadJSONInvalidBody(t *testing.T) {
	req := httptest.NewRequest("POST", "/", strings.NewReader("not json"))
	var v map[string]string
	err := readJSON(req, &v)
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

// --- isUniqueViolation ---

func TestIsUniqueViolationMax(t *testing.T) {
	tests := []struct {
		msg  string
		want bool
	}{
		{"UNIQUE constraint failed: tasks.dedup_key", true},
		{"constraint failed", true},
		{"code 2067", true},
		{"some other error", false},
	}
	for _, tt := range tests {
		err := &testError{msg: tt.msg}
		got := isUniqueViolation(err)
		if got != tt.want {
			t.Errorf("isUniqueViolation(%q) = %v, want %v", tt.msg, got, tt.want)
		}
	}
}

type testError struct{ msg string }

func (e *testError) Error() string { return e.msg }

// --- isTransportError ---

func TestIsTransportErrorMax(t *testing.T) {
	tests := []struct {
		msg  string
		want bool
	}{
		{"connection refused", true},
		{"no such host", true},
		{"connection reset", true},
		{"deadline exceeded", true},
		{"context canceled", false},
		{"EOF", false},
		{"some app error", false},
	}
	for _, tt := range tests {
		err := &testError{msg: tt.msg}
		got := isTransportError(err)
		if got != tt.want {
			t.Errorf("isTransportError(%q) = %v, want %v", tt.msg, got, tt.want)
		}
	}
}

// --- dispatchTask: worker not found ---

func TestDispatchTaskWorkerNotFound(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	s := New(Config{Registry: reg, Tasks: taskStore, Addr: "127.0.0.1:0"})

	ctx := context.Background()
	tk, _ := taskStore.Create(ctx, "missing-worker", "test prompt")

	s.dispatchTask(ctx, tk.ID)

	// Task should be failed
	got, _ := taskStore.Get(ctx, tk.ID)
	if got.State != tasks.StateFailed {
		t.Errorf("state = %s, want failed", got.State)
	}
}

// --- dispatchTask: worker unavailable (offline) ---

func TestDispatchTaskWorkerUnavailable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	s := New(Config{Registry: reg, Tasks: taskStore, Addr: "127.0.0.1:0"})

	ctx := context.Background()
	w := &workers.Worker{Name: "offline-w", Endpoint: "http://localhost:9999"}
	reg.Add(w)
	// Worker is offline by default

	tk, _ := taskStore.Create(ctx, "offline-w", "test prompt")
	s.dispatchTask(ctx, tk.ID)

	got, _ := taskStore.Get(ctx, tk.ID)
	if got.State != tasks.StateFailed {
		t.Errorf("state = %s, want failed", got.State)
	}
}

// --- sendTask: worker returns non-200 ---

func TestSendTaskNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`{"error":"internal"}`))
	}))
	defer srv.Close()

	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	s := New(Config{Registry: reg, Tasks: taskStore, Addr: "127.0.0.1:0"})

	_, err = s.sendTask(context.Background(), srv.URL, "task-1", "prompt", 10*time.Second, "")
	if err == nil {
		t.Error("expected error for non-200 response")
	}
}

// --- sendTask: with apiKey ---

func TestSendTaskWithAPIKeyMax(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"output": "ok"})
	}))
	defer srv.Close()

	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	s := New(Config{Registry: reg, Tasks: taskStore, Addr: "127.0.0.1:0"})

	_, err = s.sendTask(context.Background(), srv.URL, "task-1", "prompt", 10*time.Second, "my-api-key")
	if err != nil {
		t.Fatal(err)
	}
	if gotAuth != "Bearer my-api-key" {
		t.Errorf("Authorization = %q", gotAuth)
	}
}

// --- matchesRule ---

func TestMatchesRuleFilter(t *testing.T) {
	rule := workers.EventRule{
		Source: "github",
		On:     []string{"push"},
		Filter: map[string]string{"ref": "refs/heads/main"},
		Prompt: "review {{.ref}}",
	}
	ev := &events.Event{
		Source: "github",
		Type:   "push",
		Attrs:  events.Attrs{"ref": "refs/heads/main"},
	}
	if !matchesRule(rule, ev) {
		t.Error("expected match")
	}

	// Non-matching filter
	ev2 := &events.Event{
		Source: "github",
		Type:   "push",
		Attrs:  events.Attrs{"ref": "refs/heads/develop"},
	}
	if matchesRule(rule, ev2) {
		t.Error("expected no match for different ref")
	}
}

// --- buildTaskContext: well-known attrs ---

func TestBuildTaskContextAttrs(t *testing.T) {
	ev := &events.Event{
		Source:  "github",
		Actor:   "user",
		Subject: "org/repo",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     42,
			"diff":       "some diff",
			"head_sha":   "abc",
		},
	}
	ctx, err := buildTaskContext(ev)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	json.Unmarshal([]byte(ctx), &m)
	if m["repo_owner"] != "org" {
		t.Errorf("repo_owner = %v", m["repo_owner"])
	}
	if m["diff"] != "some diff" {
		t.Errorf("diff = %v", m["diff"])
	}
}

// --- validateDisposableEnv ---

func TestValidateDisposableEnvMax(t *testing.T) {
	tests := []struct {
		key     string
		wantErr bool
	}{
		{"WORKER_API_KEY", true},
		{"worker_port", true},
		{"HOME", true},
		{"CLAUDE_MODEL", false},
		{"CUSTOM_VAR", false},
	}
	for _, tt := range tests {
		err := validateDisposableEnv(tt.key, "val")
		if tt.wantErr && err == nil {
			t.Errorf("validateDisposableEnv(%q) = nil, want error", tt.key)
		}
		if !tt.wantErr && err != nil {
			t.Errorf("validateDisposableEnv(%q) = %v, want nil", tt.key, err)
		}
	}
}

// --- completeEvent: no events store ---

func TestCompleteEventNoStore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	s := New(Config{Registry: reg, Tasks: taskStore, Addr: "127.0.0.1:0"})
	// events is nil — should not panic
	s.completeEvent(context.Background(), "ev-1", true)
	s.completeEvent(context.Background(), "", true)
}

// --- writeJSON: marshal error ---

func TestWriteJSONMarshalErrorMax(t *testing.T) {
	w := httptest.NewRecorder()
	// func() values can't be marshaled
	writeJSON(w, 200, map[string]any{"bad": func() {}})
	if w.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", w.Code)
	}
}

// --- renderPrompt ---

func TestRenderPromptMax(t *testing.T) {
	rule := workers.EventRule{
		Source: "github",
		On:     []string{"push"},
		Prompt: "Review {{.subject}} by {{.actor}}",
	}
	ev := &events.Event{
		Source:  "github",
		Type:    "push",
		Actor:   "alice",
		Subject: "org/repo",
		Attrs:   events.Attrs{},
	}
	result, err := renderPrompt(rule, ev)
	if err != nil {
		t.Fatal(err)
	}
	if result != "Review org/repo by alice" {
		t.Errorf("prompt = %q", result)
	}
}

func TestRenderPromptInvalidTemplateMax(t *testing.T) {
	rule := workers.EventRule{
		Prompt: "{{.missing_field_that_does_not_exist_in_data_wontwork",
	}
	_, err := renderPrompt(rule, &events.Event{Attrs: events.Attrs{}})
	if err == nil {
		t.Error("expected error for invalid template")
	}
}
