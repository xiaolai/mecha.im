package serve

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"mecha.im/internal/event"
	"mecha.im/internal/policy"
	"mecha.im/internal/store"
	"mecha.im/internal/task"
	"mecha.im/internal/worker"
	"mecha.im/internal/writeback"
)

// testFullServer creates a server with registry, tasks, events, and writeback.
// The mock GitHub server records all API calls for assertions.
func testFullServer(t *testing.T, ghHandler http.Handler) (*Server, *event.Store, func()) {
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
	events := event.NewStore(db)

	ghSrv := httptest.NewServer(ghHandler)
	restore := writeback.OverrideAPIBase(ghSrv.URL)
	wb := writeback.NewClient("test-gh-token", nil)

	s := New(Config{
		Registry:  reg,
		Tasks:     tasks,
		Events:    events,
		WriteBack: wb,
		Addr:      "127.0.0.1:0",
	})
	return s, events, func() {
		restore()
		ghSrv.Close()
		db.Close()
	}
}

// ghRecorder records GitHub API calls made by writeback.
type ghRecorder struct {
	mu    sync.Mutex
	calls []ghCall
}

type ghCall struct {
	Method string
	Path   string
	Body   string
}

func (r *ghRecorder) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		body := make([]byte, 0)
		if req.Body != nil {
			body, _ = readBody(req)
		}
		r.mu.Lock()
		r.calls = append(r.calls, ghCall{
			Method: req.Method,
			Path:   req.URL.Path,
			Body:   string(body),
		})
		r.mu.Unlock()
		w.WriteHeader(200)
	})
}

func (r *ghRecorder) getCalls() []ghCall {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := make([]ghCall, len(r.calls))
	copy(cp, r.calls)
	return cp
}

func readBody(r *http.Request) ([]byte, error) {
	buf := make([]byte, 4096)
	n, _ := r.Body.Read(buf)
	return buf[:n], nil
}

// setupDispatchEvent creates a worker, event, and task wired together and ready
// for dispatch. Returns task ID and event ID.
func setupDispatchEvent(t *testing.T, s *Server, es *event.Store, workerEndpoint string, w *worker.Worker) (string, string) {
	t.Helper()
	ctx := context.Background()

	if err := s.reg.Add(w); err != nil {
		t.Fatal(err)
	}
	if err := s.reg.Start(w.Name); err != nil {
		t.Fatal(err)
	}

	ev := &event.Event{
		Source:  "github",
		Type:    "pull_request",
		Actor:   "alice",
		Subject: "testorg/testrepo",
		Attrs: event.Attrs{
			"repo_owner": "testorg",
			"repo_name":  "testrepo",
			"number":     42,
			"sender":     "alice",
			"head_sha":   "abc123def",
		},
	}
	if err := es.Create(ctx, ev); err != nil {
		t.Fatal(err)
	}
	if err := es.SetMatched(ctx, ev.ID, w.Name); err != nil {
		t.Fatal(err)
	}

	tk, err := s.tasks.CreateWithEvent(ctx, w.Name, "review this PR", "", ev.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := es.SetDispatched(ctx, ev.ID, tk.ID); err != nil {
		t.Fatal(err)
	}

	return tk.ID, ev.ID
}

func TestDoWriteBack_AllowAll(t *testing.T) {
	rec := &ghRecorder{}
	s, es, cleanup := testFullServer(t, rec.handler())
	defer cleanup()

	workerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"output":  "looks good",
			"comment": map[string]string{"body": "LGTM"},
			"status":  map[string]string{"state": "success", "description": "passed"},
			"labels":  map[string]any{"add": []string{"approved"}},
		})
	}))
	defer workerSrv.Close()

	w := &worker.Worker{Name: "allow-all-w", Endpoint: workerSrv.URL}
	taskID, eventID := setupDispatchEvent(t, s, es, workerSrv.URL, w)

	s.dispatchTask(context.Background(), taskID)

	// Task should be completed
	tk, _ := s.tasks.Get(context.Background(), taskID)
	if tk.State != task.StateCompleted {
		t.Errorf("task state = %q, want completed", tk.State)
	}

	// Event should be completed (writeback succeeded, no policy blocking)
	ev, _ := es.Get(context.Background(), eventID)
	if ev.State != event.StateCompleted {
		t.Errorf("event state = %q, want completed", ev.State)
	}

	// GitHub should have received comment, status, and label calls
	calls := rec.getCalls()
	var hasComment, hasStatus, hasLabel bool
	for _, c := range calls {
		if c.Method == "POST" && strings.Contains(c.Path, "/comments") {
			hasComment = true
		}
		if c.Method == "POST" && strings.Contains(c.Path, "/statuses/") {
			hasStatus = true
		}
		if c.Method == "POST" && strings.Contains(c.Path, "/labels") {
			hasLabel = true
		}
	}
	if !hasComment {
		t.Error("expected comment API call")
	}
	if !hasStatus {
		t.Error("expected status API call")
	}
	if !hasLabel {
		t.Error("expected label API call")
	}
}

func TestDoWriteBack_PolicyBlocksComment(t *testing.T) {
	rec := &ghRecorder{}
	s, es, cleanup := testFullServer(t, rec.handler())
	defer cleanup()

	workerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"output":  "review done",
			"comment": map[string]string{"body": "This should be blocked"},
			"status":  map[string]string{"state": "success"},
		})
	}))
	defer workerSrv.Close()

	w := &worker.Worker{
		Name:     "block-comment-w",
		Endpoint: workerSrv.URL,
		Policy: map[string]any{
			"comment": map[string]any{"allow": false},
			"status":  map[string]any{"allow": true},
		},
	}
	taskID, eventID := setupDispatchEvent(t, s, es, workerSrv.URL, w)

	s.dispatchTask(context.Background(), taskID)

	// Event should still complete (policy blocking is not a failure)
	ev, _ := es.Get(context.Background(), eventID)
	if ev.State != event.StateCompleted {
		t.Errorf("event state = %q, want completed", ev.State)
	}

	// GitHub should NOT receive comment, but SHOULD receive status
	calls := rec.getCalls()
	for _, c := range calls {
		if strings.Contains(c.Path, "/comments") {
			t.Error("comment should have been blocked by policy")
		}
	}
	var hasStatus bool
	for _, c := range calls {
		if strings.Contains(c.Path, "/statuses/") {
			hasStatus = true
		}
	}
	if !hasStatus {
		t.Error("status should have been allowed through policy")
	}
}

func TestDoWriteBack_PolicyBlocksAll(t *testing.T) {
	rec := &ghRecorder{}
	s, es, cleanup := testFullServer(t, rec.handler())
	defer cleanup()

	workerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"output":  "review done",
			"comment": map[string]string{"body": "blocked"},
			"status":  map[string]string{"state": "success"},
			"labels":  map[string]any{"add": []string{"bug"}},
			"commit":  map[string]string{"message": "fix"},
		})
	}))
	defer workerSrv.Close()

	w := &worker.Worker{
		Name:     "block-all-w",
		Endpoint: workerSrv.URL,
		Policy: map[string]any{
			"comment": map[string]any{"allow": false},
			"status":  map[string]any{"allow": false},
			"labels":  map[string]any{"allow": false},
			"commit":  map[string]any{"allow": false},
		},
	}
	taskID, eventID := setupDispatchEvent(t, s, es, workerSrv.URL, w)

	s.dispatchTask(context.Background(), taskID)

	ev, _ := es.Get(context.Background(), eventID)
	if ev.State != event.StateCompleted {
		t.Errorf("event state = %q, want completed", ev.State)
	}

	calls := rec.getCalls()
	if len(calls) > 0 {
		t.Errorf("expected no GitHub API calls, got %d: %+v", len(calls), calls)
	}
}

func TestDoWriteBack_PolicyTruncatesComment(t *testing.T) {
	rec := &ghRecorder{}
	s, es, cleanup := testFullServer(t, rec.handler())
	defer cleanup()

	longBody := strings.Repeat("a", 200)
	workerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"output":  "done",
			"comment": map[string]string{"body": longBody},
		})
	}))
	defer workerSrv.Close()

	w := &worker.Worker{
		Name:     "truncate-w",
		Endpoint: workerSrv.URL,
		Policy: map[string]any{
			"comment": map[string]any{"allow": true, "max_length": 50},
		},
	}
	taskID, _ := setupDispatchEvent(t, s, es, workerSrv.URL, w)

	s.dispatchTask(context.Background(), taskID)

	calls := rec.getCalls()
	var commentBody string
	for _, c := range calls {
		if c.Method == "POST" && strings.Contains(c.Path, "/comments") {
			var payload map[string]string
			json.Unmarshal([]byte(c.Body), &payload)
			commentBody = payload["body"]
		}
	}
	if commentBody == "" {
		t.Fatal("expected comment API call")
	}
	if !strings.Contains(commentBody, "truncated by policy") {
		t.Errorf("comment should contain truncation marker, got: %s", commentBody[:min(len(commentBody), 100)])
	}
	if strings.Contains(commentBody, longBody) {
		t.Error("comment should have been truncated, but contains full body")
	}
}

func TestDoWriteBack_PolicyLabelBlocklist(t *testing.T) {
	rec := &ghRecorder{}
	s, es, cleanup := testFullServer(t, rec.handler())
	defer cleanup()

	workerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"output": "done",
			"labels": map[string]any{
				"add":    []string{"approved", "production", "safe"},
				"remove": []string{"needs-review", "production"},
			},
		})
	}))
	defer workerSrv.Close()

	w := &worker.Worker{
		Name:     "blocklist-w",
		Endpoint: workerSrv.URL,
		Policy: map[string]any{
			"labels": map[string]any{
				"allow":   true,
				"blocked": []any{"production"},
			},
		},
	}
	taskID, _ := setupDispatchEvent(t, s, es, workerSrv.URL, w)

	s.dispatchTask(context.Background(), taskID)

	calls := rec.getCalls()
	for _, c := range calls {
		if strings.Contains(c.Path, "/labels") {
			if strings.Contains(c.Body, "production") {
				t.Errorf("blocked label 'production' should not appear in API call: %s %s body=%s",
					c.Method, c.Path, c.Body)
			}
		}
	}
	var addCalls int
	for _, c := range calls {
		if c.Method == "POST" && strings.Contains(c.Path, "/labels") {
			addCalls++
		}
	}
	if addCalls == 0 {
		t.Error("expected at least one label add call for non-blocked labels")
	}
}

func TestDoWriteBack_UnparseableResult(t *testing.T) {
	rec := &ghRecorder{}
	s, es, cleanup := testFullServer(t, rec.handler())
	defer cleanup()

	workerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("plain text response, not JSON"))
	}))
	defer workerSrv.Close()

	w := &worker.Worker{Name: "bad-json-w", Endpoint: workerSrv.URL}
	taskID, eventID := setupDispatchEvent(t, s, es, workerSrv.URL, w)

	s.dispatchTask(context.Background(), taskID)

	tk, _ := s.tasks.Get(context.Background(), taskID)
	if tk.State != task.StateCompleted {
		t.Errorf("task state = %q, want completed", tk.State)
	}

	ev, _ := es.Get(context.Background(), eventID)
	if ev.State != event.StateCompleted {
		t.Errorf("event state = %q, want completed (unparseable result is not a failure)", ev.State)
	}

	calls := rec.getCalls()
	if len(calls) > 0 {
		t.Errorf("expected no GitHub API calls for unparseable result, got %d", len(calls))
	}
}

func TestDoWriteBack_GitHubError_EventStaysDispatched(t *testing.T) {
	s, es, cleanup := testFullServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`{"message":"internal server error"}`))
	}))
	defer cleanup()

	workerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"output":  "done",
			"comment": map[string]string{"body": "LGTM"},
		})
	}))
	defer workerSrv.Close()

	w := &worker.Worker{Name: "gh-fail-w", Endpoint: workerSrv.URL}
	taskID, eventID := setupDispatchEvent(t, s, es, workerSrv.URL, w)

	s.dispatchTask(context.Background(), taskID)

	tk, _ := s.tasks.Get(context.Background(), taskID)
	if tk.State != task.StateCompleted {
		t.Errorf("task state = %q, want completed (result stored even if writeback fails)", tk.State)
	}

	ev, _ := es.Get(context.Background(), eventID)
	if ev.State != event.StateDispatched {
		t.Errorf("event state = %q, want dispatched (writeback failed, stays for retry)", ev.State)
	}
}

func TestDoWriteBack_SendError_EventFailed(t *testing.T) {
	rec := &ghRecorder{}
	s, es, cleanup := testFullServer(t, rec.handler())
	defer cleanup()

	w := &worker.Worker{Name: "send-fail-w", Endpoint: "http://127.0.0.1:1"}
	taskID, eventID := setupDispatchEvent(t, s, es, "http://127.0.0.1:1", w)

	s.dispatchTask(context.Background(), taskID)

	tk, _ := s.tasks.Get(context.Background(), taskID)
	if tk.State != task.StateFailed {
		t.Errorf("task state = %q, want failed", tk.State)
	}

	ev, _ := es.Get(context.Background(), eventID)
	if ev.State != event.StateFailed {
		t.Errorf("event state = %q, want failed", ev.State)
	}

	calls := rec.getCalls()
	if len(calls) > 0 {
		t.Errorf("expected no GitHub API calls on send error, got %d", len(calls))
	}
}

func TestGetWorkerPolicy_None(t *testing.T) {
	s, _, cleanup := testFullServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer cleanup()

	s.reg.Add(&worker.Worker{Name: "no-policy-w", Endpoint: "http://x"})

	filter := s.getWorkerPolicy("no-policy-w")
	if _, ok := filter.(*policy.AllowAll); !ok {
		t.Errorf("expected *AllowAll, got %T", filter)
	}
}

func TestGetWorkerPolicy_Configured(t *testing.T) {
	s, _, cleanup := testFullServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer cleanup()

	s.reg.Add(&worker.Worker{
		Name:     "policy-w",
		Endpoint: "http://x",
		Policy: map[string]any{
			"comment": map[string]any{"allow": false},
		},
	})

	filter := s.getWorkerPolicy("policy-w")
	if _, ok := filter.(*policy.AllowAll); ok {
		t.Error("expected RuleFilter, got AllowAll")
	}
}

func TestGetWorkerPolicy_WorkerNotFound(t *testing.T) {
	s, _, cleanup := testFullServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer cleanup()

	filter := s.getWorkerPolicy("ghost")
	if _, ok := filter.(*policy.AllowAll); !ok {
		t.Errorf("expected *AllowAll for missing worker, got %T", filter)
	}
}

func TestCompleteEvent_Success(t *testing.T) {
	s, es, cleanup := testFullServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer cleanup()
	ctx := context.Background()

	ev := &event.Event{Source: "github", Type: "push"}
	es.Create(ctx, ev)
	es.SetMatched(ctx, ev.ID, "w")
	es.SetDispatched(ctx, ev.ID, "t1")

	s.completeEvent(ctx, ev.ID, true)

	got, _ := es.Get(ctx, ev.ID)
	if got.State != event.StateCompleted {
		t.Errorf("state = %q, want completed", got.State)
	}
}

func TestCompleteEvent_Failure(t *testing.T) {
	s, es, cleanup := testFullServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer cleanup()
	ctx := context.Background()

	ev := &event.Event{Source: "github", Type: "push"}
	es.Create(ctx, ev)
	es.SetMatched(ctx, ev.ID, "w")
	es.SetDispatched(ctx, ev.ID, "t1")

	s.completeEvent(ctx, ev.ID, false)

	got, _ := es.Get(ctx, ev.ID)
	if got.State != event.StateFailed {
		t.Errorf("state = %q, want failed", got.State)
	}
}

func TestCompleteEvent_EmptyID(t *testing.T) {
	s, _, cleanup := testFullServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer cleanup()

	// Should not panic
	s.completeEvent(context.Background(), "", true)
}

func TestDoWriteBack_NoEventStore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, _ := store.Open(path)
	defer db.Close()
	reg, _ := worker.NewRegistry(db)
	tasks := task.NewStore(db)

	s := New(Config{Registry: reg, Tasks: tasks, Addr: "127.0.0.1:0"})

	ok := s.doWriteBack(context.Background(), "t1", "e1", "w1", `{"output":"x"}`)
	if !ok {
		t.Error("doWriteBack should return true when events is nil")
	}
}

func TestDoWriteBack_EmptyEventID(t *testing.T) {
	rec := &ghRecorder{}
	s, _, cleanup := testFullServer(t, rec.handler())
	defer cleanup()

	ok := s.doWriteBack(context.Background(), "t1", "", "w1", `{"output":"x"}`)
	if !ok {
		t.Error("doWriteBack should return true when eventID is empty")
	}
}

func TestDispatchFullPipeline_WithEvents(t *testing.T) {
	rec := &ghRecorder{}
	s, es, cleanup := testFullServer(t, rec.handler())
	defer cleanup()

	workerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"output":  "all good",
			"comment": map[string]string{"body": "Approved"},
			"status":  map[string]string{"state": "success", "description": "CI passed"},
		})
	}))
	defer workerSrv.Close()

	w := &worker.Worker{
		Name:     "pipeline-w",
		Endpoint: workerSrv.URL,
		Policy: map[string]any{
			"comment": map[string]any{"allow": true},
			"status":  map[string]any{"allow": true},
		},
	}
	taskID, eventID := setupDispatchEvent(t, s, es, workerSrv.URL, w)

	ctx, cancel := context.WithCancel(context.Background())
	go s.dispatchLoop(ctx)
	s.pending <- taskID

	deadline := time.After(5 * time.Second)
	for {
		select {
		case <-deadline:
			cancel()
			t.Fatal("pipeline timed out")
		default:
			ev, _ := es.Get(context.Background(), eventID)
			if ev.State == event.StateCompleted {
				cancel()
				calls := rec.getCalls()
				if len(calls) == 0 {
					t.Error("expected GitHub API calls from writeback")
				}
				return
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
}
