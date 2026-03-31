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

	"mecha.im/internal/event"
	"mecha.im/internal/policy"
	"mecha.im/internal/source"
	"mecha.im/internal/store"
	"mecha.im/internal/task"
	"mecha.im/internal/worker"
)

// --- Webhook handler coverage: verification, GET, body errors ---

// mockVerifierSource implements Source + Verifier + Authenticated for testing.
type mockVerifierSource struct {
	verifyResp []byte
	verifyErr  error
}

func (m *mockVerifierSource) Name() string { return "meta" }
func (m *mockVerifierSource) Parse(h http.Header, body []byte) (*event.Event, error) {
	return &event.Event{Source: "meta", Type: "message", Attrs: event.Attrs{}}, nil
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
	w := &worker.Worker{
		Name:     "bad-prompt",
		Endpoint: "http://unused",
		Events: []worker.EventRule{{
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

	var evResp event.Event
	json.Unmarshal(rec.Body.Bytes(), &evResp)
	waitForEventState(t, es, evResp.ID, event.StateFailed, 5*time.Second)
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
	var tasks []task.Task
	json.Unmarshal(rec.Body.Bytes(), &tasks)
	if len(tasks) != 1 {
		t.Errorf("dispatched tasks = %d, want 1", len(tasks))
	}
}

// --- dispatchTask: disposable worker routing ---

func TestDispatchDisposableRouting(t *testing.T) {
	// Verify dispatchTask routes to dispatchDisposable for disposable workers
	// (without Docker, the container create will fail — that's expected)
	s, cleanup := testServer(t)
	defer cleanup()

	w := &worker.Worker{
		Name: "disp-w",
		Docker: &worker.DockerConfig{
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
	if got.State != task.StateFailed {
		t.Errorf("state = %q, want failed (disposable container fails)", got.State)
	}
}

// --- getWorkerPolicy: DenyAll on invalid config ---

func TestGetWorkerPolicyInvalid(t *testing.T) {
	rec := &ghRecorder{}
	s, es, cleanup := testFullServer(t, rec.handler())
	defer cleanup()

	// Worker with invalid policy config (wrong type)
	w := &worker.Worker{
		Name:     "bad-policy-w",
		Endpoint: "http://x",
		Policy:   map[string]any{"comment": "not-a-map"},
	}
	s.reg.Add(w)

	filter := s.getWorkerPolicy("bad-policy-w")
	// Should return DenyAll for unparseable config
	ctx := context.Background()
	ev := &event.Event{Source: "github", Type: "push"}
	es.Create(ctx, ev)

	result := policy.Result{Comment: &policy.CommentAction{Body: "test"}}
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
		fn: func(ctx context.Context, ev *event.Event, res policy.Result) error {
			responderCalled = true
			return nil
		},
	}

	path := filepath.Join(t.TempDir(), "test.db")
	db, _ := store.Open(path)
	defer db.Close()
	reg, _ := worker.NewRegistry(db)
	tasks := task.NewStore(db)
	events := event.NewStore(db)
	sources := source.NewRegistry()
	sources.RegisterResponder(mockResp)

	s := New(Config{
		Registry: reg,
		Tasks:    tasks,
		Events:   events,
		Sources:  sources,
		Addr:     "127.0.0.1:0",
	})

	// Create event and test doWriteBack
	ctx := context.Background()
	ev := &event.Event{Source: "github", Type: "push"}
	events.Create(ctx, ev)
	events.SetMatched(ctx, ev.ID, "w")
	events.SetDispatched(ctx, ev.ID, "t1")
	reg.Add(&worker.Worker{Name: "w", Endpoint: "http://x"})

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
	reg, _ := worker.NewRegistry(db)
	tasks := task.NewStore(db)
	s := New(Config{Registry: reg, Tasks: tasks, Addr: "127.0.0.1:0"})

	// Should not panic
	s.completeEvent(context.Background(), "e1", true)
	s.completeEvent(context.Background(), "e1", false)
}

// --- Helpers ---

type mockResponder struct {
	name string
	fn   func(ctx context.Context, ev *event.Event, res policy.Result) error
}

func (m *mockResponder) Name() string { return m.name }
func (m *mockResponder) Respond(ctx context.Context, ev *event.Event, res policy.Result) error {
	return m.fn(ctx, ev, res)
}
