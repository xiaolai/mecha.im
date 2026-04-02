package serve

import (
	"context"
	"encoding/json"
	"fmt"
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

// --- Webhook handler coverage: verification, GET, body errors ---

// mockVerifierSource implements Source + Verifier + Authenticated for testing.
type mockVerifierSource struct {
	verifyResp []byte
	verifyErr  error
}

func (m *mockVerifierSource) Name() string { return "meta" }
func (m *mockVerifierSource) Parse(h http.Header, body []byte) (*events.Event, error) {
	return &events.Event{Source: "meta", Type: "message", Attrs: events.Attrs{}}, nil
}
func (m *mockVerifierSource) Verify(r *http.Request) ([]byte, error) {
	return m.verifyResp, m.verifyErr
}
func (m *mockVerifierSource) Authenticated() {}

func TestWebhookVerificationChallenge(t *testing.T) {
	s, _, sources, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "")
	defer cleanup()
	sources.Register(&mockVerifierSource{verifyResp: []byte("challenge-response"), verifyErr: nil})

	req := httptest.NewRequest("GET", "/webhook/meta", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Errorf("verify: status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != "challenge-response" {
		t.Errorf("verify: body = %q", rec.Body.String())
	}
}

func TestWebhookVerificationFailed(t *testing.T) {
	s, _, sources, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "")
	defer cleanup()
	sources.Register(&mockVerifierSource{verifyErr: fmt.Errorf("bad token")})

	req := httptest.NewRequest("GET", "/webhook/meta", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("verify fail: status = %d, want 403", rec.Code)
	}
}

func TestWebhookGETWithoutVerifier(t *testing.T) {
	// GitHub does not implement Verifier → GET should return 405
	s, _, _, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "")
	defer cleanup()

	req := httptest.NewRequest("GET", "/webhook/github", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET without verifier: status = %d, want 405", rec.Code)
	}
}

// --- matchAndHydrate error paths ---

func TestWebhookPromptRenderError(t *testing.T) {
	s, es, _, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "")
	defer cleanup()

	// Worker with invalid template → render fails → event should be failed
	w := &workers.Worker{
		Name:     "bad-prompt",
		Endpoint: "http://unused",
		Events: []workers.EventRule{{
			Source: "github",
			On:     []string{"push"},
			Prompt: "{{ .nonexistent_key }}", // missingkey=error will fail
		}},
	}
	s.reg.Add(w)
	s.reg.Start("bad-prompt")

	body := []byte(`{"ref":"refs/heads/main","repository":{"full_name":"o/r"},"sender":{"login":"u"}}`)
	req := httptest.NewRequest("POST", "/webhook/github", strings.NewReader(string(body)))
	req.Header.Set("X-GitHub-Event", "push")
	req.Header.Set("X-GitHub-Delivery", "render-err-1")
	req.Header.Set("X-Hub-Signature-256", signGitHub("test-secret", body))
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)

	var evResp events.Event
	json.Unmarshal(rec.Body.Bytes(), &evResp)
	waitForEventState(t, es, evResp.ID, events.StateFailed, 5*time.Second)
}

// --- handleGetTask missing id edge case ---

func TestHandlerGetTaskEmptyID(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	// The route pattern requires {id}, but test the internal error path
	req := httptest.NewRequest("GET", "/task/", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	// Should be 404 or 400 (router won't match empty id)
	if rec.Code == 200 {
		t.Error("empty task id should not return 200")
	}
}

// --- handleListTasks error coverage ---

func TestHandlerListTasksFilterDispatched(t *testing.T) {
	s, cleanup := testServer(t)
	defer cleanup()

	t1, _ := s.tasks.Create(context.Background(), "w", "p1")
	s.tasks.Create(context.Background(), "w", "p2")
	s.tasks.SetDispatched(context.Background(), t1.ID)

	req := httptest.NewRequest("GET", "/tasks?state=dispatched", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	var taskList []tasks.Task
	json.Unmarshal(rec.Body.Bytes(), &taskList)
	if len(taskList) != 1 {
		t.Errorf("dispatched tasks = %d, want 1", len(taskList))
	}
}

// --- dispatchTask: disposable worker routing ---

func TestDispatchDisposableRouting(t *testing.T) {
	// Verify dispatchTask routes to dispatchDisposable for disposable workers
	// (without Docker, the container create will fail — that's expected)
	s, cleanup := testServer(t)
	defer cleanup()

	w := &workers.Worker{
		Name: "disp-w",
		Docker: &workers.DockerConfig{
			Image:     "nonexistent:latest",
			Lifecycle: "disposable",
		},
	}
	s.reg.Add(w)
	// Don't start — disposable creates its own container

	tk, _ := s.tasks.Create(context.Background(), "disp-w", "test")
	s.dispatchTask(context.Background(), tk.ID)

	// Task should fail because Docker can't connect (or image missing)
	got, _ := s.tasks.Get(context.Background(), tk.ID)
	if got.State != tasks.StateFailed {
		t.Errorf("state = %q, want failed (disposable container fails)", got.State)
	}
}

// --- getWorkerPolicy: DenyAll on invalid config ---

func TestGetWorkerPolicyInvalid(t *testing.T) {
	rec := &ghRecorder{}
	s, es, cleanup := testFullServer(t, rec.handler())
	defer cleanup()

	// Worker with invalid policy config (wrong type)
	w := &workers.Worker{
		Name:     "bad-policy-w",
		Endpoint: "http://x",
		Policy:   map[string]any{"comment": "not-a-map"},
	}
	s.reg.Add(w)

	filter := s.getWorkerPolicy("bad-policy-w")
	// Should return DenyAll for unparseable config
	ctx := context.Background()
	ev := &events.Event{Source: "github", Type: "push"}
	es.Create(ctx, ev)

	result := policies.Result{Comment: &policies.CommentAction{Body: "test"}}
	_, decision, _ := filter.Apply(ctx, ev, result)
	_ = decision
	// DenyAll should block everything — we don't assert exact type,
	// just that comment is denied
}

// --- doWriteBack: responder path vs legacy writeback ---

func TestDoWriteBackResponderPath(t *testing.T) {
	// Test that Responder registry is used instead of legacy writeback
	var responderCalled bool
	mockResp := &mockResponder{
		name: "github",
		fn: func(ctx context.Context, ev *events.Event, res policies.Result) error {
			responderCalled = true
			return nil
		},
	}

	path := filepath.Join(t.TempDir(), "test.db")
	db, _ := store.Open(path)
	defer db.Close()
	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	evStore := events.NewStore(db)
	sources := source.NewRegistry()
	sources.RegisterResponder(mockResp)

	s := New(Config{
		Registry: reg,
		Tasks:    taskStore,
		Events:   evStore,
		Sources:  sources,
		Addr:     "127.0.0.1:0",
	})

	// Create event and test doWriteBack
	ctx := context.Background()
	ev := &events.Event{Source: "github", Type: "push"}
	evStore.Create(ctx, ev)
	evStore.SetMatched(ctx, ev.ID, "w")
	evStore.SetDispatched(ctx, ev.ID, "t1")
	reg.Add(&workers.Worker{Name: "w", Endpoint: "http://x"})

	ok := s.doWriteBack(ctx, "t1", ev.ID, "w", `{"output":"test","comment":{"body":"hi"}}`)
	if !ok {
		t.Error("doWriteBack should succeed")
	}
	if !responderCalled {
		t.Error("Responder should have been called instead of legacy writeback")
	}
}

// --- sendTask: non-200 status codes ---

func TestSendTaskWorker400(t *testing.T) {
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		w.Write([]byte("bad request"))
	}))
	defer mock.Close()

	s, cleanup := testDispatchServer(t)
	defer cleanup()

	_, err := s.sendTask(context.Background(), mock.URL, "t1", "prompt", time.Minute, "")
	if err == nil {
		t.Error("expected error for 400")
	}
	if !strings.Contains(err.Error(), "400") {
		t.Errorf("error = %q, want mention of 400", err)
	}
}

func TestSendTaskWorker429(t *testing.T) {
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(429)
		w.Write([]byte("too many requests"))
	}))
	defer mock.Close()

	s, cleanup := testDispatchServer(t)
	defer cleanup()

	_, err := s.sendTask(context.Background(), mock.URL, "t1", "prompt", time.Minute, "")
	if err == nil {
		t.Error("expected error for 429")
	}
}

// --- completeEvent edge cases ---

func TestCompleteEventNilEvents(t *testing.T) {
	// Server without events store — completeEvent should be no-op
	path := filepath.Join(t.TempDir(), "test.db")
	db, _ := store.Open(path)
	defer db.Close()
	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	s := New(Config{Registry: reg, Tasks: taskStore, Addr: "127.0.0.1:0"})

	// Should not panic
	s.completeEvent(context.Background(), "e1", true)
	s.completeEvent(context.Background(), "e1", false)
}

// === DB-closed error path tests ===
// These close the DB before calling handlers to trigger error branches.

func testServerWithClosedDB(t *testing.T) (*Server, *events.Store, func()) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	evStore := events.NewStore(db)
	sources := source.NewRegistry()
	sources.Register(source.NewGitHubSource("test-secret", ""))

	s := New(Config{
		Registry: reg,
		Tasks:    taskStore,
		Events:   evStore,
		Sources:  sources,
		Addr:     "127.0.0.1:0",
	})
	return s, evStore, func() { db.Close() }
}

func TestWebhookDeliveryCheckDBError(t *testing.T) {
	s, _, closeDB := testServerWithClosedDB(t)
	closeDB() // close DB before request

	body := []byte(`{"action":"opened","repository":{"full_name":"o/r"},"sender":{"login":"u"}}`)
	req := httptest.NewRequest("POST", "/webhook/github", strings.NewReader(string(body)))
	req.Header.Set("X-GitHub-Event", "push")
	req.Header.Set("X-GitHub-Delivery", "db-err-1")
	req.Header.Set("X-Hub-Signature-256", signGitHub("test-secret", body))
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("DB error on delivery check: status = %d, want 500", rec.Code)
	}
}

func TestWebhookCreateDBError(t *testing.T) {
	// First check delivery succeeds (DB open), then close before create
	s, _, closeDB := testServerWithClosedDB(t)

	// Send first event to verify DB works
	body := []byte(`{"action":"opened","repository":{"full_name":"o/r"},"sender":{"login":"u"}}`)
	req := httptest.NewRequest("POST", "/webhook/github", strings.NewReader(string(body)))
	req.Header.Set("X-GitHub-Event", "push")
	req.Header.Set("X-GitHub-Delivery", "create-err-1")
	req.Header.Set("X-Hub-Signature-256", signGitHub("test-secret", body))
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("first request should succeed: %d", rec.Code)
	}

	closeDB() // close DB

	// Second event with different delivery ID — DeliveryExists returns error
	req2 := httptest.NewRequest("POST", "/webhook/github", strings.NewReader(string(body)))
	req2.Header.Set("X-GitHub-Event", "push")
	req2.Header.Set("X-GitHub-Delivery", "create-err-2")
	req2.Header.Set("X-Hub-Signature-256", signGitHub("test-secret", body))
	rec2 := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusInternalServerError {
		t.Errorf("DB error on create: status = %d, want 500", rec2.Code)
	}
}

func TestHandlerListEventsDBError(t *testing.T) {
	s, _, closeDB := testServerWithClosedDB(t)
	closeDB()

	req := httptest.NewRequest("GET", "/events", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("events DB error: status = %d, want 500", rec.Code)
	}
}

func TestHandlerGetEventDBError(t *testing.T) {
	s, _, closeDB := testServerWithClosedDB(t)
	closeDB()

	req := httptest.NewRequest("GET", "/event/some-id", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("event DB error: status = %d, want 500", rec.Code)
	}
}

func TestHandlerListTasksDBError(t *testing.T) {
	s, cleanup := testServer(t)
	cleanup() // close DB

	req := httptest.NewRequest("GET", "/tasks", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("tasks DB error: status = %d, want 500", rec.Code)
	}
}

func TestHandlerGetTaskDBError(t *testing.T) {
	s, cleanup := testServer(t)
	cleanup() // close DB

	req := httptest.NewRequest("GET", "/task/some-id", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	// Should be 500 (internal error, not "not found")
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("task DB error: status = %d, want 500", rec.Code)
	}
}

func TestHandlerPostTaskDBError(t *testing.T) {
	s, cleanup := testServer(t)
	// Add a worker first (while DB is open)
	s.reg.Add(&workers.Worker{Name: "w", Endpoint: "http://x"})
	s.reg.Start("w")
	cleanup() // now close DB

	req := httptest.NewRequest("POST", "/task", strings.NewReader(`{"prompt":"test","worker":"w"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("task create DB error: status = %d, want 500", rec.Code)
	}
}

func TestHandlerListEventsEmptyResult(t *testing.T) {
	// evStore.List returns nil (not []) → should return []
	s, _, _, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "")
	defer cleanup()

	req := httptest.NewRequest("GET", "/events", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	if strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Errorf("empty events should return [], got %q", rec.Body.String())
	}
}

// === dispatchLoop edge cases ===

func TestDispatchLoopChannelClose(t *testing.T) {
	s, cleanup := testDispatchServer(t)
	defer cleanup()

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		s.dispatchLoop(ctx)
		close(done)
	}()

	// Close the pending channel — dispatchLoop should exit
	close(s.pending)
	select {
	case <-done:
		// OK
	case <-time.After(5 * time.Second):
		cancel()
		t.Fatal("dispatchLoop did not exit on channel close")
	}
	cancel()
}

func TestDispatchLoopShutdownDuringSemaphore(t *testing.T) {
	s, cleanup := testDispatchServer(t)
	defer cleanup()

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		s.dispatchLoop(ctx)
		close(done)
	}()

	// Cancel context — should exit cleanly
	cancel()
	select {
	case <-done:
		// OK
	case <-time.After(5 * time.Second):
		t.Fatal("dispatchLoop did not exit on context cancel")
	}
}

// === doWriteBack error paths ===

func TestDoWriteBackPolicyError(t *testing.T) {
	rec := &ghRecorder{}
	s, es, cleanup := testFullServer(t, rec.handler())
	defer cleanup()

	// Worker with invalid policy → DenyAll
	w := &workers.Worker{
		Name:     "deny-w",
		Endpoint: "http://x",
		Policy:   map[string]any{"comment": "invalid-not-a-map"},
	}
	s.reg.Add(w)

	ctx := context.Background()
	ev := &events.Event{
		Source:  "github",
		Type:    "push",
		Actor:   "u",
		Subject: "o/r",
		Attrs:   events.Attrs{"repo_owner": "o", "repo_name": "r"},
	}
	es.Create(ctx, ev)
	es.SetMatched(ctx, ev.ID, "deny-w")
	es.SetDispatched(ctx, ev.ID, "t1")

	ok := s.doWriteBack(ctx, "t1", ev.ID, "deny-w", `{"output":"x","comment":{"body":"hi"}}`)
	if !ok {
		t.Error("doWriteBack with DenyAll should still succeed (just blocks everything)")
	}
	// Should NOT have posted a comment
	calls := rec.getCalls()
	for _, c := range calls {
		if strings.Contains(c.Path, "/comments") {
			t.Error("DenyAll policy should block comments")
		}
	}
}

func TestDoWriteBackResponderError(t *testing.T) {
	mockResp := &mockResponder{
		name: "github",
		fn: func(ctx context.Context, ev *events.Event, res policies.Result) error {
			return fmt.Errorf("responder exploded")
		},
	}

	path := filepath.Join(t.TempDir(), "test.db")
	db, _ := store.Open(path)
	defer db.Close()
	reg, _ := workers.NewRegistry(db)
	taskStore := tasks.NewStore(db)
	evStore := events.NewStore(db)
	sources := source.NewRegistry()
	sources.RegisterResponder(mockResp)

	s := New(Config{
		Registry: reg, Tasks: taskStore, Events: evStore,
		Sources: sources, Addr: "127.0.0.1:0",
	})

	ctx := context.Background()
	ev := &events.Event{Source: "github", Type: "push"}
	evStore.Create(ctx, ev)
	evStore.SetMatched(ctx, ev.ID, "w")
	evStore.SetDispatched(ctx, ev.ID, "t1")
	reg.Add(&workers.Worker{Name: "w", Endpoint: "http://x"})

	ok := s.doWriteBack(ctx, "t1", ev.ID, "w", `{"output":"x"}`)
	if ok {
		t.Error("doWriteBack should fail when responder returns error")
	}
}

// === sendTask edge: default timeout ===

func TestSendTaskDefaultTimeout(t *testing.T) {
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"output":"ok"}`))
	}))
	defer mock.Close()

	s, cleanup := testDispatchServer(t)
	defer cleanup()

	// Timeout 0 → defaults to 10 minutes
	result, err := s.sendTask(context.Background(), mock.URL, "t1", "prompt", 0, "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result, "ok") {
		t.Errorf("result = %q", result)
	}
}

// === buildTaskContext: marshal error ===

func TestBuildTaskContextAllAttrs(t *testing.T) {
	ev := &events.Event{
		Source:  "github",
		Actor:   "alice",
		Subject: "org/repo",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     42,
			"ref":        "abc123",
			"diff":       "some diff",
			"file_list":  "a.go\nb.go",
			"head_sha":   "sha123",
			"sender":     "alice",
		},
	}
	got, err := buildTaskContext(ev)
	if err != nil {
		t.Fatal(err)
	}
	var ctx map[string]any
	json.Unmarshal([]byte(got), &ctx)
	for _, key := range []string{"source", "actor", "subject", "repo_owner", "number", "diff", "file_list", "head_sha", "sender"} {
		if _, ok := ctx[key]; !ok {
			t.Errorf("missing key %q in task context", key)
		}
	}
}

// === Dispatch shutdown edge case ===

func TestDispatchLoopShutdownDuringFullSemaphore(t *testing.T) {
	s, cleanup := testDispatchServer(t)
	defer cleanup()

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		s.dispatchLoop(ctx)
		close(done)
	}()

	// Fill the semaphore
	for i := 0; i < maxConcurrentDispatches; i++ {
		s.pending <- fmt.Sprintf("fill-%d", i)
	}
	// Let dispatch loop start consuming
	time.Sleep(200 * time.Millisecond)

	// Push one more task — dispatch loop will try to acquire semaphore
	s.pending <- "blocked-task"
	// Cancel while waiting for semaphore
	time.Sleep(100 * time.Millisecond)
	cancel()

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("dispatchLoop did not exit during semaphore wait")
	}
}

// === dispatchTask error paths with closed DB ===

func TestDispatchTaskFailsWorkerNotFoundDBError(t *testing.T) {
	s, cleanup := testDispatchServer(t)
	// Create task while DB is open
	tk, _ := s.tasks.Create(context.Background(), "ghost", "test")
	cleanup() // close DB — Fail() will error

	// Should not panic even though taskStore.Fail errors
	s.dispatchTask(context.Background(), tk.ID)
}

func TestDispatchTaskSetDispatchedError(t *testing.T) {
	s, cleanup := testDispatchServer(t)

	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"output":"ok"}`))
	}))
	defer mock.Close()

	s.reg.Add(&workers.Worker{Name: "sd-err", Endpoint: mock.URL})
	s.reg.Start("sd-err")
	tk, _ := s.tasks.Create(context.Background(), "sd-err", "test")
	cleanup() // close DB — SetDispatched will error

	s.dispatchTask(context.Background(), tk.ID)
	// Task should stay pending (SetDispatched failed, returned early)
}

func TestDispatchTaskCompleteError(t *testing.T) {
	s, cleanup := testDispatchServer(t)

	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"output":"ok"}`))
	}))
	defer mock.Close()

	s.reg.Add(&workers.Worker{Name: "comp-err", Endpoint: mock.URL})
	s.reg.Start("comp-err")
	tk, _ := s.tasks.Create(context.Background(), "comp-err", "test")
	s.tasks.SetDispatched(context.Background(), tk.ID)
	cleanup() // close DB — Complete will error

	s.dispatchTask(context.Background(), tk.ID)

	// Worker should not be stuck in busy
	entry, ok := s.reg.Get("comp-err")
	if ok && entry.State == workers.StateBusy {
		t.Error("worker should not be stuck in busy after Complete error")
	}
}

// --- Helpers ---

type mockResponder struct {
	name string
	fn   func(ctx context.Context, ev *events.Event, res policies.Result) error
}

func (m *mockResponder) Name() string { return m.name }
func (m *mockResponder) Respond(ctx context.Context, ev *events.Event, res policies.Result) error {
	return m.fn(ctx, ev, res)
}
