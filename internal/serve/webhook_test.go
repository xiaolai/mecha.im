package serve

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"mecha.im/internal/event"
	"mecha.im/internal/source"
	"mecha.im/internal/store"
	"mecha.im/internal/task"
	"mecha.im/internal/worker"
	"mecha.im/internal/writeback"
)

// --- helpers ---

func signGitHub(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// testWebhookServer creates a server with sources, events, workers, and
// a mock GitHub API for write-back. It wires the full pipeline:
// webhook → parse → match → hydrate → dispatch → policy → respond.
func testWebhookServer(t *testing.T, ghHandler http.Handler, apiKey string) (*Server, *event.Store, *source.Registry, func()) {
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

	sources := source.NewRegistry()
	sources.Register(source.NewGitHubSource("test-secret", "test-token"))
	sources.RegisterResponder(wb)

	s := New(Config{
		Registry:  reg,
		Tasks:     tasks,
		Events:    events,
		Sources:   sources,
		WriteBack: wb,
		Addr:      "127.0.0.1:0",
		APIKey:    apiKey,
	})
	return s, events, sources, func() {
		restore()
		ghSrv.Close()
		db.Close()
	}
}

// waitForEventState polls until the event reaches the expected state or timeout.
func waitForEventState(t *testing.T, es *event.Store, eventID string, want event.State, timeout time.Duration) {
	t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case <-deadline:
			ev, _ := es.Get(context.Background(), eventID)
			t.Fatalf("event %s did not reach state %q within %v (current: %q)", eventID, want, timeout, ev.State)
		default:
			ev, err := es.Get(context.Background(), eventID)
			if err == nil && ev.State == want {
				return
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
}

// --- Full pipeline: webhook → dispatch → writeback → complete ---

func TestWebhookFullPipeline_GitHubPR(t *testing.T) {
	// Scenario: a real GitHub PR webhook flows through the entire pipeline:
	// webhook POST → HMAC validation → parse → persist → match → dispatch → writeback → complete
	rec := &ghRecorder{}
	s, es, _, cleanup := testWebhookServer(t, rec.handler(), "")
	defer cleanup()

	// Create a mock worker that returns a review comment
	workerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"output":  "Looks good",
			"comment": map[string]string{"body": "LGTM from mecha"},
			"status":  map[string]string{"state": "success", "description": "review passed"},
		})
	}))
	defer workerSrv.Close()

	w := &worker.Worker{
		Name:     "pr-reviewer",
		Endpoint: workerSrv.URL,
		Events: []worker.EventRule{{
			Source: "github",
			On:     []string{"pull_request.opened"},
			Prompt: "Review PR #{{ .number }} by {{ .actor }}: {{ .title }}",
		}},
	}
	if err := s.reg.Add(w); err != nil {
		t.Fatal(err)
	}
	if err := s.reg.Start("pr-reviewer"); err != nil {
		t.Fatal(err)
	}

	// Start dispatch loop
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.dispatchLoop(ctx)

	// Build a realistic GitHub PR webhook payload
	prBody := []byte(`{
		"action": "opened",
		"number": 42,
		"repository": {"full_name": "org/repo"},
		"sender": {"login": "alice"},
		"pull_request": {
			"number": 42,
			"title": "Add feature X",
			"body": "Description here",
			"head": {"sha": "abc123", "ref": "feature-x"},
			"base": {"ref": "main", "sha": "def456"}
		}
	}`)

	req := httptest.NewRequest("POST", "/webhook/github", strings.NewReader(string(prBody)))
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-GitHub-Delivery", "delivery-pr-42")
	req.Header.Set("X-Hub-Signature-256", signGitHub("test-secret", prBody))
	rec2 := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec2, req)

	if rec2.Code != http.StatusAccepted {
		t.Fatalf("webhook status = %d, want 202: %s", rec2.Code, rec2.Body.String())
	}

	// Verify event was created
	var evResp event.Event
	if err := json.Unmarshal(rec2.Body.Bytes(), &evResp); err != nil {
		t.Fatalf("unmarshal event response: %v", err)
	}
	if evResp.ID == "" {
		t.Fatal("expected event ID in response")
	}
	if evResp.Actor != "alice" {
		t.Errorf("Actor = %q, want alice", evResp.Actor)
	}
	if evResp.Subject != "org/repo" {
		t.Errorf("Subject = %q, want org/repo", evResp.Subject)
	}

	// Wait for full pipeline completion
	waitForEventState(t, es, evResp.ID, event.StateCompleted, 10*time.Second)

	// Verify GitHub write-back: comment + status
	calls := rec.getCalls()
	var hasComment, hasStatus bool
	for _, c := range calls {
		if c.Method == "POST" && strings.Contains(c.Path, "/comments") {
			hasComment = true
			if !strings.Contains(c.Body, "LGTM from mecha") {
				t.Errorf("comment body = %q, want LGTM from mecha", c.Body)
			}
		}
		if c.Method == "POST" && strings.Contains(c.Path, "/statuses/") {
			hasStatus = true
		}
	}
	if !hasComment {
		t.Error("expected GitHub comment API call")
	}
	if !hasStatus {
		t.Error("expected GitHub status API call")
	}

	// Verify the event final state
	ev, _ := es.Get(context.Background(), evResp.ID)
	if ev.WorkerName != "pr-reviewer" {
		t.Errorf("WorkerName = %q, want pr-reviewer", ev.WorkerName)
	}
}

// --- Deduplication ---

func TestWebhookDeduplication(t *testing.T) {
	s, es, _, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "")
	defer cleanup()

	body := []byte(`{"action":"opened","number":1,"repository":{"full_name":"o/r"},"sender":{"login":"u"},"pull_request":{"number":1,"title":"T","head":{"sha":"a","ref":"b"},"base":{"ref":"main"}}}`)
	sig := signGitHub("test-secret", body)

	// First request: accepted
	req1 := httptest.NewRequest("POST", "/webhook/github", strings.NewReader(string(body)))
	req1.Header.Set("X-GitHub-Event", "pull_request")
	req1.Header.Set("X-GitHub-Delivery", "dedup-test-1")
	req1.Header.Set("X-Hub-Signature-256", sig)
	rec1 := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusAccepted {
		t.Fatalf("first request: status = %d, want 202", rec1.Code)
	}

	// Second request with same delivery ID: duplicate
	req2 := httptest.NewRequest("POST", "/webhook/github", strings.NewReader(string(body)))
	req2.Header.Set("X-GitHub-Event", "pull_request")
	req2.Header.Set("X-GitHub-Delivery", "dedup-test-1")
	req2.Header.Set("X-Hub-Signature-256", sig)
	rec2 := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("duplicate: status = %d, want 200", rec2.Code)
	}
	var resp map[string]string
	json.Unmarshal(rec2.Body.Bytes(), &resp)
	if resp["status"] != "duplicate" {
		t.Errorf("duplicate response = %v", resp)
	}

	// Verify only one event exists
	evts, _ := es.List(context.Background(), "")
	if len(evts) != 1 {
		t.Errorf("events = %d, want 1", len(evts))
	}
}

// --- Authentication ---

func TestWebhookInvalidSignature(t *testing.T) {
	s, _, _, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "")
	defer cleanup()

	body := []byte(`{"action":"opened"}`)
	req := httptest.NewRequest("POST", "/webhook/github", strings.NewReader(string(body)))
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-Hub-Signature-256", "sha256=wrong")
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("invalid sig: status = %d, want 401", rec.Code)
	}
}

func TestWebhookUnknownSource(t *testing.T) {
	s, _, _, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "")
	defer cleanup()

	req := httptest.NewRequest("POST", "/webhook/unknown", strings.NewReader(`{}`))
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("unknown source: status = %d, want 404", rec.Code)
	}
}

func TestWebhookGenericRequiresAPIKey(t *testing.T) {
	// GenericSource does NOT implement Authenticated, so it must use API key auth
	s, _, sources, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "server-key")
	defer cleanup()
	sources.Register(source.NewGenericSource("custom", ""))

	// No API key → 401
	body := []byte(`{"msg": "hello"}`)
	req := httptest.NewRequest("POST", "/webhook/custom", strings.NewReader(string(body)))
	req.Header.Set("X-Event-Type", "test.event")
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("generic without key: status = %d, want 401", rec.Code)
	}

	// With API key → accepted
	req2 := httptest.NewRequest("POST", "/webhook/custom", strings.NewReader(string(body)))
	req2.Header.Set("X-Event-Type", "test.event")
	req2.Header.Set("X-API-Key", "server-key")
	rec2 := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusAccepted {
		t.Errorf("generic with key: status = %d, want 202", rec2.Code)
	}
}

func TestWebhookGitHubBypassesAPIKey(t *testing.T) {
	// GitHub implements Authenticated → skips API key, uses HMAC instead
	s, _, _, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "server-key")
	defer cleanup()

	body := []byte(`{"action":"opened","repository":{"full_name":"o/r"},"sender":{"login":"u"}}`)
	req := httptest.NewRequest("POST", "/webhook/github", strings.NewReader(string(body)))
	req.Header.Set("X-GitHub-Event", "push")
	req.Header.Set("X-Hub-Signature-256", signGitHub("test-secret", body))
	// No X-API-Key — should still work because GitHub is Authenticated
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Errorf("github HMAC: status = %d, want 202", rec.Code)
	}
}

// --- Matching ---

func TestWebhookNoMatchingWorker(t *testing.T) {
	s, es, _, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "")
	defer cleanup()

	// No workers registered → event should be skipped
	body := []byte(`{"action":"opened","repository":{"full_name":"o/r"},"sender":{"login":"u"},"pull_request":{"number":1,"title":"T","head":{"sha":"a","ref":"b"},"base":{"ref":"main"}}}`)
	req := httptest.NewRequest("POST", "/webhook/github", strings.NewReader(string(body)))
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-GitHub-Delivery", "no-match-1")
	req.Header.Set("X-Hub-Signature-256", signGitHub("test-secret", body))
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", rec.Code)
	}

	var evResp event.Event
	json.Unmarshal(rec.Body.Bytes(), &evResp)
	waitForEventState(t, es, evResp.ID, event.StateSkipped, 5*time.Second)
}

func TestWebhookAutoFalseSkipped(t *testing.T) {
	s, es, _, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "")
	defer cleanup()

	// Worker with auto: false should not dispatch
	autoFalse := false
	w := &worker.Worker{
		Name:     "manual-worker",
		Endpoint: "http://unused",
		Events: []worker.EventRule{{
			Source: "github",
			On:     []string{"pull_request.opened"},
			Prompt: "review",
			Auto:   &autoFalse,
		}},
	}
	if err := s.reg.Add(w); err != nil {
		t.Fatal(err)
	}

	body := []byte(`{"action":"opened","number":1,"repository":{"full_name":"o/r"},"sender":{"login":"u"},"pull_request":{"number":1,"title":"T","head":{"sha":"a","ref":"b"},"base":{"ref":"main"}}}`)
	req := httptest.NewRequest("POST", "/webhook/github", strings.NewReader(string(body)))
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-GitHub-Delivery", "auto-false-1")
	req.Header.Set("X-Hub-Signature-256", signGitHub("test-secret", body))
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)

	var evResp event.Event
	json.Unmarshal(rec.Body.Bytes(), &evResp)
	// auto: false → event ends up skipped (no auto rules matched)
	waitForEventState(t, es, evResp.ID, event.StateSkipped, 5*time.Second)
}

// --- Event listing ---

func TestWebhookEventListAndGet(t *testing.T) {
	s, _, _, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "")
	defer cleanup()

	body := []byte(`{"action":"opened","repository":{"full_name":"o/r"},"sender":{"login":"u"}}`)
	req := httptest.NewRequest("POST", "/webhook/github", strings.NewReader(string(body)))
	req.Header.Set("X-GitHub-Event", "push")
	req.Header.Set("X-GitHub-Delivery", "list-test-1")
	req.Header.Set("X-Hub-Signature-256", signGitHub("test-secret", body))
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)

	var evResp event.Event
	json.Unmarshal(rec.Body.Bytes(), &evResp)

	// GET /events
	req2 := httptest.NewRequest("GET", "/events", nil)
	rec2 := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec2, req2)
	if rec2.Code != 200 {
		t.Fatalf("list events: status = %d", rec2.Code)
	}
	var events []event.Event
	json.Unmarshal(rec2.Body.Bytes(), &events)
	if len(events) == 0 {
		t.Error("expected at least one event")
	}

	// GET /event/{id}
	req3 := httptest.NewRequest("GET", "/event/"+evResp.ID, nil)
	rec3 := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec3, req3)
	if rec3.Code != 200 {
		t.Fatalf("get event: status = %d", rec3.Code)
	}
	var got event.Event
	json.Unmarshal(rec3.Body.Bytes(), &got)
	if got.Source != "github" {
		t.Errorf("Source = %q", got.Source)
	}
}

// --- Crash recovery ---

func TestCrashRecoverySourceGone(t *testing.T) {
	// Events with unregistered sources should be marked failed
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}

	reg, _ := worker.NewRegistry(db)
	tasks := task.NewStore(db)
	es := event.NewStore(db)
	sources := source.NewRegistry() // empty — no sources registered

	ev := &event.Event{Source: "gone-source", Type: "push"}
	if err := es.Create(context.Background(), ev); err != nil {
		t.Fatal(err)
	}

	srv := New(Config{
		Registry: reg,
		Tasks:    tasks,
		Events:   es,
		Sources:  sources,
		Addr:     "127.0.0.1:0",
	})

	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() { errCh <- srv.Start(ctx) }()
	time.Sleep(1 * time.Second)
	cancel()
	<-errCh

	got, _ := es.Get(context.Background(), ev.ID)
	if got.State != event.StateFailed {
		t.Errorf("state = %q, want failed (source gone)", got.State)
	}
	db.Close()
}

func TestCrashRecoveryReprocess(t *testing.T) {
	// Events with registered sources should be re-matched (skipped if no worker)
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}

	reg, _ := worker.NewRegistry(db)
	tasks := task.NewStore(db)
	es := event.NewStore(db)
	sources := source.NewRegistry()
	sources.Register(source.NewGitHubSource("secret", ""))

	ev := &event.Event{Source: "github", Type: "push"}
	if err := es.Create(context.Background(), ev); err != nil {
		t.Fatal(err)
	}

	srv := New(Config{
		Registry: reg,
		Tasks:    tasks,
		Events:   es,
		Sources:  sources,
		Addr:     "127.0.0.1:0",
	})

	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() { errCh <- srv.Start(ctx) }()
	time.Sleep(2 * time.Second)
	cancel()
	<-errCh

	// No workers registered → event should be skipped (re-matched but no match)
	got, _ := es.Get(context.Background(), ev.ID)
	if got.State != event.StateSkipped {
		t.Errorf("state = %q, want skipped (re-matched, no workers)", got.State)
	}
	db.Close()
}

// --- Policy with full pipeline ---

func TestWebhookPolicyBlocksWriteBack(t *testing.T) {
	rec := &ghRecorder{}
	s, es, _, cleanup := testWebhookServer(t, rec.handler(), "")
	defer cleanup()

	workerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"output":  "done",
			"comment": map[string]string{"body": "This should be blocked"},
			"status":  map[string]string{"state": "success"},
		})
	}))
	defer workerSrv.Close()

	w := &worker.Worker{
		Name:     "policy-worker",
		Endpoint: workerSrv.URL,
		Events: []worker.EventRule{{
			Source: "github",
			On:     []string{"push"},
			Prompt: "analyze push by {{ .actor }}",
		}},
		Policy: map[string]any{
			"comment": map[string]any{"allow": false},
			"status":  map[string]any{"allow": true},
		},
	}
	if err := s.reg.Add(w); err != nil {
		t.Fatal(err)
	}
	if err := s.reg.Start("policy-worker"); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.dispatchLoop(ctx)

	body := []byte(`{"ref":"refs/heads/main","after":"deadbeef","repository":{"full_name":"org/repo"},"sender":{"login":"bob"},"commits":[]}`)
	req := httptest.NewRequest("POST", "/webhook/github", strings.NewReader(string(body)))
	req.Header.Set("X-GitHub-Event", "push")
	req.Header.Set("X-GitHub-Delivery", "policy-test-1")
	req.Header.Set("X-Hub-Signature-256", signGitHub("test-secret", body))
	rec2 := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec2, req)

	var evResp event.Event
	json.Unmarshal(rec2.Body.Bytes(), &evResp)
	waitForEventState(t, es, evResp.ID, event.StateCompleted, 10*time.Second)

	// Comment should be blocked, status should pass
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

// --- Multi-source ---

func TestWebhookMultipleSources(t *testing.T) {
	s, es, sources, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "api-key")
	defer cleanup()

	// Register generic source alongside GitHub
	sources.Register(source.NewGenericSource("slack", "X-Slack-Event"))

	// Worker listening to slack events
	workerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"output": "got slack message"})
	}))
	defer workerSrv.Close()

	w := &worker.Worker{
		Name:     "slack-bot",
		Endpoint: workerSrv.URL,
		Events: []worker.EventRule{{
			Source: "slack",
			On:     []string{"message"},
			Prompt: "respond to: {{ .text }}",
		}},
	}
	if err := s.reg.Add(w); err != nil {
		t.Fatal(err)
	}
	if err := s.reg.Start("slack-bot"); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.dispatchLoop(ctx)

	// Post to slack source (requires API key since GenericSource is not Authenticated)
	body := []byte(`{"text": "hello from slack", "channel": "#general"}`)
	req := httptest.NewRequest("POST", "/webhook/slack", strings.NewReader(string(body)))
	req.Header.Set("X-Slack-Event", "message")
	req.Header.Set("X-API-Key", "api-key")
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("slack webhook: status = %d, want 202: %s", rec.Code, rec.Body.String())
	}

	var evResp event.Event
	json.Unmarshal(rec.Body.Bytes(), &evResp)
	waitForEventState(t, es, evResp.ID, event.StateCompleted, 10*time.Second)

	// Verify the event metadata
	ev, _ := es.Get(context.Background(), evResp.ID)
	if ev.Source != "slack" {
		t.Errorf("Source = %q, want slack", ev.Source)
	}
	if ev.WorkerName != "slack-bot" {
		t.Errorf("WorkerName = %q, want slack-bot", ev.WorkerName)
	}
}

// --- Worker failure ---

func TestWebhookWorkerFailure(t *testing.T) {
	s, es, _, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "")
	defer cleanup()

	workerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`{"error":"internal failure"}`))
	}))
	defer workerSrv.Close()

	w := &worker.Worker{
		Name:     "failing-worker",
		Endpoint: workerSrv.URL,
		Events: []worker.EventRule{{
			Source: "github",
			On:     []string{"push"},
			Prompt: "analyze",
		}},
	}
	s.reg.Add(w)
	s.reg.Start("failing-worker")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.dispatchLoop(ctx)

	body := []byte(`{"ref":"refs/heads/main","repository":{"full_name":"o/r"},"sender":{"login":"u"}}`)
	req := httptest.NewRequest("POST", "/webhook/github", strings.NewReader(string(body)))
	req.Header.Set("X-GitHub-Event", "push")
	req.Header.Set("X-GitHub-Delivery", "fail-test-1")
	req.Header.Set("X-Hub-Signature-256", signGitHub("test-secret", body))
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)

	var evResp event.Event
	json.Unmarshal(rec.Body.Bytes(), &evResp)
	waitForEventState(t, es, evResp.ID, event.StateFailed, 10*time.Second)
}

// --- Concurrent webhooks ---

func TestWebhookConcurrent(t *testing.T) {
	var mu sync.Mutex
	workerCalls := 0

	s, es, _, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}), "")
	defer cleanup()

	workerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		workerCalls++
		mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"output": "ok"})
	}))
	defer workerSrv.Close()

	w := &worker.Worker{
		Name:     "concurrent-w",
		Endpoint: workerSrv.URL,
		Events: []worker.EventRule{{
			Source: "github",
			On:     []string{"push"},
			Prompt: "analyze",
		}},
	}
	s.reg.Add(w)
	s.reg.Start("concurrent-w")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.dispatchLoop(ctx)

	// Send 5 concurrent webhooks with unique delivery IDs
	var wg sync.WaitGroup
	eventIDs := make([]string, 5)
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			body := []byte(`{"ref":"refs/heads/main","repository":{"full_name":"o/r"},"sender":{"login":"u"}}`)
			req := httptest.NewRequest("POST", "/webhook/github", strings.NewReader(string(body)))
			req.Header.Set("X-GitHub-Event", "push")
			req.Header.Set("X-GitHub-Delivery", "concurrent-"+string(rune('a'+idx)))
			req.Header.Set("X-Hub-Signature-256", signGitHub("test-secret", body))
			rec := httptest.NewRecorder()
			s.httpSrv.Handler.ServeHTTP(rec, req)
			if rec.Code == http.StatusAccepted {
				var evResp event.Event
				json.Unmarshal(rec.Body.Bytes(), &evResp)
				eventIDs[idx] = evResp.ID
			}
		}(i)
	}
	wg.Wait()

	// Wait for all events to complete or fail (worker is single-threaded, so they serialize)
	time.Sleep(3 * time.Second)

	// Verify all events were created
	allEvents, _ := es.List(context.Background(), "")
	if len(allEvents) < 5 {
		t.Errorf("created %d events, want 5", len(allEvents))
	}
}

// --- Attrs persistence after hydration ---

func TestWebhookAttrsPersisted(t *testing.T) {
	s, es, _, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "")
	defer cleanup()

	// No workers → event will be skipped, but attrs from parse should persist
	body := []byte(`{
		"action": "opened",
		"number": 7,
		"repository": {"full_name": "test/attrs"},
		"sender": {"login": "tester"},
		"pull_request": {
			"number": 7,
			"title": "Test attrs",
			"head": {"sha": "sha123", "ref": "feat"},
			"base": {"ref": "main", "sha": "base456"}
		}
	}`)
	req := httptest.NewRequest("POST", "/webhook/github", strings.NewReader(string(body)))
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-GitHub-Delivery", "attrs-test-1")
	req.Header.Set("X-Hub-Signature-256", signGitHub("test-secret", body))
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)

	var evResp event.Event
	json.Unmarshal(rec.Body.Bytes(), &evResp)
	waitForEventState(t, es, evResp.ID, event.StateSkipped, 5*time.Second)

	// Verify attrs were persisted to DB
	ev, _ := es.Get(context.Background(), evResp.ID)
	if ev.Actor != "tester" {
		t.Errorf("Actor = %q, want tester", ev.Actor)
	}
	if ev.Subject != "test/attrs" {
		t.Errorf("Subject = %q, want test/attrs", ev.Subject)
	}
	if ev.Attrs["title"] != "Test attrs" {
		t.Errorf("title = %v, want Test attrs", ev.Attrs["title"])
	}
	if ev.Attrs["head_sha"] != "sha123" {
		t.Errorf("head_sha = %v, want sha123", ev.Attrs["head_sha"])
	}
}

// --- GitLab webhook through full pipeline ---

func TestWebhookGitLabPipeline(t *testing.T) {
	rec := &ghRecorder{}
	s, es, sources, cleanup := testWebhookServer(t, rec.handler(), "")
	defer cleanup()

	sources.Register(source.NewGitLabSource("gl-secret"))

	workerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"output": "MR reviewed"})
	}))
	defer workerSrv.Close()

	w := &worker.Worker{
		Name:     "gl-reviewer",
		Endpoint: workerSrv.URL,
		Events: []worker.EventRule{{
			Source: "gitlab",
			On:     []string{"merge_request.open"},
			Prompt: "Review MR by {{ .actor }}",
		}},
	}
	if err := s.reg.Add(w); err != nil {
		t.Fatal(err)
	}
	if err := s.reg.Start("gl-reviewer"); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.dispatchLoop(ctx)

	body := []byte(`{
		"object_kind": "merge_request",
		"user": {"username": "dev"},
		"user_username": "dev",
		"project": {"path_with_namespace": "group/project"},
		"object_attributes": {
			"iid": 10, "title": "Add feature", "description": "Details",
			"action": "open", "source_branch": "feature", "target_branch": "main",
			"last_commit": {"id": "abc123"}
		}
	}`)
	req := httptest.NewRequest("POST", "/webhook/gitlab", strings.NewReader(string(body)))
	req.Header.Set("X-Gitlab-Event", "Merge Request Hook")
	req.Header.Set("X-Gitlab-Token", "gl-secret")
	req.Header.Set("X-Gitlab-Event-UUID", "gl-dedup-1")
	rec2 := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec2, req)

	if rec2.Code != http.StatusAccepted {
		t.Fatalf("gitlab webhook: status = %d, want 202: %s", rec2.Code, rec2.Body.String())
	}

	var evResp event.Event
	json.Unmarshal(rec2.Body.Bytes(), &evResp)
	waitForEventState(t, es, evResp.ID, event.StateCompleted, 10*time.Second)

	ev, _ := es.Get(context.Background(), evResp.ID)
	if ev.Actor != "dev" {
		t.Errorf("Actor = %q, want dev", ev.Actor)
	}
	if ev.Subject != "group/project" {
		t.Errorf("Subject = %q, want group/project", ev.Subject)
	}
	if ev.DeliveryID != "gl-dedup-1" {
		t.Errorf("DeliveryID = %q, want gl-dedup-1 (X-Gitlab-Event-UUID)", ev.DeliveryID)
	}
}

// --- Filter matching edge cases ---

func TestWebhookFilterMatching(t *testing.T) {
	s, es, _, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "")
	defer cleanup()

	workerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"output": "filtered"})
	}))
	defer workerSrv.Close()

	// Worker that only matches action=closed
	w := &worker.Worker{
		Name:     "close-handler",
		Endpoint: workerSrv.URL,
		Events: []worker.EventRule{{
			Source: "github",
			On:     []string{"pull_request.closed"},
			Filter: map[string]string{"action": "closed"},
			Prompt: "PR closed",
		}},
	}
	s.reg.Add(w)
	s.reg.Start("close-handler")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.dispatchLoop(ctx)

	// Send "opened" event — should NOT match the "closed" filter
	body := []byte(`{"action":"opened","number":1,"repository":{"full_name":"o/r"},"sender":{"login":"u"},"pull_request":{"number":1,"title":"T","head":{"sha":"a","ref":"b"},"base":{"ref":"main"}}}`)
	req := httptest.NewRequest("POST", "/webhook/github", strings.NewReader(string(body)))
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-GitHub-Delivery", "filter-test-1")
	req.Header.Set("X-Hub-Signature-256", signGitHub("test-secret", body))
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)

	var evResp event.Event
	json.Unmarshal(rec.Body.Bytes(), &evResp)
	waitForEventState(t, es, evResp.ID, event.StateSkipped, 5*time.Second)
}

// --- Event listing with state filter ---

func TestWebhookEventListByState(t *testing.T) {
	s, es, _, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "")
	defer cleanup()

	// Create events in different states
	ev1 := &event.Event{Source: "github", Type: "push"}
	ev2 := &event.Event{Source: "github", Type: "push"}
	es.Create(context.Background(), ev1)
	es.Create(context.Background(), ev2)
	es.SetMatched(context.Background(), ev2.ID, "w")

	// Filter by received
	req := httptest.NewRequest("GET", "/events?state=received", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	var events []event.Event
	json.Unmarshal(rec.Body.Bytes(), &events)
	if len(events) != 1 {
		t.Errorf("received events = %d, want 1", len(events))
	}

	// Filter by matched
	req2 := httptest.NewRequest("GET", "/events?state=matched", nil)
	rec2 := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec2, req2)
	var matched []event.Event
	json.Unmarshal(rec2.Body.Bytes(), &matched)
	if len(matched) != 1 {
		t.Errorf("matched events = %d, want 1", len(matched))
	}
}

// --- Event not found ---

func TestWebhookEventNotFound(t *testing.T) {
	s, _, _, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), "")
	defer cleanup()

	req := httptest.NewRequest("GET", "/event/nonexistent", nil)
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)
	if rec.Code != 404 {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

// --- Hydration only on match (not wasted) ---

func TestWebhookHydrationOnlyOnMatch(t *testing.T) {
	hydrateCalled := false
	s, es, _, cleanup := testWebhookServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// GitHub API mock — if hydration runs, this gets called
		hydrateCalled = true
		w.WriteHeader(200)
	}), "")
	defer cleanup()

	// No workers → no match → hydration should NOT run
	body := []byte(`{"action":"opened","number":1,"repository":{"full_name":"o/r"},"sender":{"login":"u"},"pull_request":{"number":1,"title":"T","head":{"sha":"a","ref":"b"},"base":{"ref":"main","sha":"c"}}}`)
	req := httptest.NewRequest("POST", "/webhook/github", strings.NewReader(string(body)))
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-GitHub-Delivery", "no-hydrate-1")
	req.Header.Set("X-Hub-Signature-256", signGitHub("test-secret", body))
	rec := httptest.NewRecorder()
	s.httpSrv.Handler.ServeHTTP(rec, req)

	var evResp event.Event
	json.Unmarshal(rec.Body.Bytes(), &evResp)
	waitForEventState(t, es, evResp.ID, event.StateSkipped, 5*time.Second)

	if hydrateCalled {
		t.Error("hydration should not run when no worker matches")
	}
}
