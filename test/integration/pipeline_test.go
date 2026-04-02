package integration

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"mecha.im/internal/events"
	"mecha.im/internal/serve"
	"mecha.im/internal/source"
	"mecha.im/internal/store"
	"mecha.im/internal/tasks"
	"mecha.im/internal/workers"
	"mecha.im/internal/writeback"
)

// apiRecorder records HTTP API calls (for mock GitHub/GitLab).
type apiRecorder struct {
	mu    sync.Mutex
	calls []apiCall
}

type apiCall struct {
	Method string
	Path   string
	Body   string
}

func (r *apiRecorder) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body []byte
		if req.Body != nil {
			body, _ = io.ReadAll(req.Body)
		}
		r.mu.Lock()
		r.calls = append(r.calls, apiCall{
			Method: req.Method,
			Path:   req.URL.Path,
			Body:   string(body),
		})
		r.mu.Unlock()
		w.WriteHeader(200)
	})
}

func (r *apiRecorder) getCalls() []apiCall {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := make([]apiCall, len(r.calls))
	copy(cp, r.calls)
	return cp
}

// prWebhookPayload returns a minimal GitHub pull_request webhook body.
func prWebhookPayload(owner, repo string, number int) []byte {
	payload := map[string]any{
		"action": "opened",
		"number": number,
		"pull_request": map[string]any{
			"number": number,
			"title":  "Test PR",
			"body":   "Fix something",
			"head": map[string]any{
				"sha": "abc123def456",
				"ref": "feature-branch",
			},
			"base": map[string]any{
				"sha": "000111222333",
				"ref": "main",
			},
		},
		"repository": map[string]any{
			"full_name": owner + "/" + repo,
		},
		"sender": map[string]any{
			"login": "alice",
		},
	}
	data, _ := json.Marshal(payload)
	return data
}

// pipelineTestServer holds all components for a full pipeline integration test.
type pipelineTestServer struct {
	Addr     string
	DB       *sql.DB
	Registry *workers.Registry
	Tasks    *tasks.Store
	Events   *events.Store
	Sources  *source.Registry
	Cancel   context.CancelFunc
}

// newPipelineServer creates and starts a pipeline test server.
// ghSrvURL is the mock GitHub API base URL.
func newPipelineServer(t *testing.T, sources *source.Registry, ghSrvURL string) (*pipelineTestServer, func()) {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "integ.db")
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}

	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatalf("workers.NewRegistry: %v", err)
	}
	taskStore := tasks.NewStore(db)
	evStore := events.NewStore(db)

	restore := writeback.OverrideAPIBase(ghSrvURL)
	wb := writeback.NewClient("test-gh-token", nil)

	port := findFreePort(t)
	addr := fmt.Sprintf("127.0.0.1:%d", port)

	srv := serve.New(serve.Config{
		Registry:  reg,
		Tasks:     taskStore,
		Events:    evStore,
		Sources:   sources,
		WriteBack: wb,
		Addr:      addr,
	})

	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() { errCh <- srv.Start(ctx) }()

	serverURL := fmt.Sprintf("http://%s", addr)
	waitForServerHealth(t, serverURL, 5*time.Second)

	pts := &pipelineTestServer{
		Addr:     addr,
		DB:       db,
		Registry: reg,
		Tasks:    taskStore,
		Events:   evStore,
		Sources:  sources,
		Cancel:   cancel,
	}

	cleanup := func() {
		cancel()
		<-errCh
		restore()
		db.Close()
	}
	return pts, cleanup
}

func TestPipeline_WebhookToWriteBack(t *testing.T) {
	ghSecret := "test-webhook-secret"

	// Mock worker returns a result with comment + status.
	mockWorker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"output":  "looks good",
			"comment": map[string]string{"body": "LGTM from integration test"},
			"status":  map[string]string{"state": "success", "description": "all checks passed"},
		})
	}))
	defer mockWorker.Close()

	// Mock GitHub API records calls.
	rec := &apiRecorder{}
	ghSrv := httptest.NewServer(rec.handler())
	defer ghSrv.Close()

	// Sources
	sources := source.NewRegistry()
	sources.Register(source.NewGitHubSource(ghSecret, ""))

	pts, cleanup := newPipelineServer(t, sources, ghSrv.URL)
	defer cleanup()

	// Register a worker with an event rule matching pull_request.opened.
	w := &workers.Worker{
		Name:     "pr-reviewer",
		Endpoint: mockWorker.URL,
		Events: []workers.EventRule{{
			Source: "github",
			On:     []string{"pull_request.opened"},
			Prompt: "Review PR #{{.number}} by {{.sender}}",
		}},
	}
	if err := pts.Registry.Add(w); err != nil {
		t.Fatalf("registry add: %v", err)
	}
	if err := pts.Registry.Start(w.Name); err != nil {
		t.Fatalf("registry start: %v", err)
	}

	// POST a GitHub PR webhook with valid HMAC.
	body := prWebhookPayload("testorg", "testrepo", 42)
	sig := signGitHub(ghSecret, body)

	req, _ := http.NewRequest("POST", "http://"+pts.Addr+"/webhook/github", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-GitHub-Delivery", "delivery-001")
	req.Header.Set("X-Hub-Signature-256", sig)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("webhook POST: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 202 {
		respBody, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 202, got %d: %s", resp.StatusCode, respBody)
	}

	// Wait for event to reach completed state.
	deadline := time.After(10 * time.Second)
	for {
		select {
		case <-deadline:
			evs, _ := pts.Events.List(context.Background(), "")
			t.Fatalf("timed out waiting for event completion; events: %+v", evs)
		default:
			evs, _ := pts.Events.List(context.Background(), "")
			for _, ev := range evs {
				if ev.State == events.StateCompleted {
					// Verify GitHub API received comment and status.
					calls := rec.getCalls()
					var hasComment, hasStatus bool
					for _, c := range calls {
						if c.Method == "POST" && strings.Contains(c.Path, "/comments") {
							hasComment = true
							if !strings.Contains(c.Body, "LGTM from integration test") {
								t.Errorf("comment body = %q", c.Body)
							}
						}
						if c.Method == "POST" && strings.Contains(c.Path, "/statuses/") {
							hasStatus = true
						}
					}
					if !hasComment {
						t.Error("expected comment API call to mock GitHub")
					}
					if !hasStatus {
						t.Error("expected status API call to mock GitHub")
					}
					return
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
}

func TestPipeline_PolicyFiltersWriteBack(t *testing.T) {
	ghSecret := "policy-test-secret"

	// Worker returns comment + labels.
	mockWorker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"output":  "review done",
			"comment": map[string]string{"body": "Looks fine"},
			"labels":  map[string]any{"add": []string{"approved"}},
		})
	}))
	defer mockWorker.Close()

	rec := &apiRecorder{}
	ghSrv := httptest.NewServer(rec.handler())
	defer ghSrv.Close()

	sources := source.NewRegistry()
	sources.Register(source.NewGitHubSource(ghSecret, ""))

	pts, cleanup := newPipelineServer(t, sources, ghSrv.URL)
	defer cleanup()

	// Worker policy: block labels, allow comment.
	w := &workers.Worker{
		Name:     "policy-test-worker",
		Endpoint: mockWorker.URL,
		Events: []workers.EventRule{{
			Source: "github",
			On:     []string{"pull_request.opened"},
			Prompt: "Review PR #{{.number}}",
		}},
		Policy: map[string]any{
			"comment": map[string]any{"allow": true},
			"labels":  map[string]any{"allow": false},
		},
	}
	if err := pts.Registry.Add(w); err != nil {
		t.Fatalf("registry add: %v", err)
	}
	if err := pts.Registry.Start(w.Name); err != nil {
		t.Fatalf("registry start: %v", err)
	}

	body := prWebhookPayload("testorg", "testrepo", 10)
	sig := signGitHub(ghSecret, body)

	req, _ := http.NewRequest("POST", "http://"+pts.Addr+"/webhook/github", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-GitHub-Delivery", "delivery-policy-001")
	req.Header.Set("X-Hub-Signature-256", sig)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("webhook POST: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != 202 {
		t.Fatalf("expected 202, got %d", resp.StatusCode)
	}

	// Wait for completion.
	deadline := time.After(10 * time.Second)
	for {
		select {
		case <-deadline:
			t.Fatal("timed out waiting for event completion")
		default:
			evs, _ := pts.Events.List(context.Background(), "")
			for _, ev := range evs {
				if ev.State == events.StateCompleted {
					calls := rec.getCalls()
					var hasComment bool
					for _, c := range calls {
						if strings.Contains(c.Path, "/labels") {
							t.Errorf("labels should have been blocked by policy, got: %s %s", c.Method, c.Path)
						}
						if strings.Contains(c.Path, "/comments") {
							hasComment = true
						}
					}
					if !hasComment {
						t.Error("comment should have been allowed through policy")
					}
					return
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
}

func TestPipeline_EventDedupBlocks(t *testing.T) {
	ghSecret := "dedup-test-secret"

	sources := source.NewRegistry()
	sources.Register(source.NewGitHubSource(ghSecret, ""))

	rec := &apiRecorder{}
	ghSrv := httptest.NewServer(rec.handler())
	defer ghSrv.Close()

	pts, cleanup := newPipelineServer(t, sources, ghSrv.URL)
	defer cleanup()

	// No workers registered -- we just care about dedup, not dispatch.
	body := prWebhookPayload("testorg", "testrepo", 99)
	sig := signGitHub(ghSecret, body)

	sendWebhook := func() *http.Response {
		req, _ := http.NewRequest("POST", "http://"+pts.Addr+"/webhook/github", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-GitHub-Event", "pull_request")
		req.Header.Set("X-GitHub-Delivery", "delivery-dedup-001")
		req.Header.Set("X-Hub-Signature-256", sig)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("webhook POST: %v", err)
		}
		return resp
	}

	// First webhook -- should be accepted.
	resp1 := sendWebhook()
	body1, _ := io.ReadAll(resp1.Body)
	resp1.Body.Close()
	if resp1.StatusCode != 202 {
		t.Fatalf("first webhook: expected 202, got %d: %s", resp1.StatusCode, body1)
	}

	// Second webhook with same delivery ID -- should be duplicate.
	resp2 := sendWebhook()
	body2, _ := io.ReadAll(resp2.Body)
	resp2.Body.Close()
	if resp2.StatusCode != 200 {
		t.Fatalf("second webhook: expected 200, got %d: %s", resp2.StatusCode, body2)
	}
	if !strings.Contains(string(body2), "duplicate") {
		t.Errorf("expected duplicate response, got: %s", body2)
	}
}

func TestPipeline_NoMatchingWorker(t *testing.T) {
	ghSecret := "nomatch-secret"

	sources := source.NewRegistry()
	sources.Register(source.NewGitHubSource(ghSecret, ""))

	rec := &apiRecorder{}
	ghSrv := httptest.NewServer(rec.handler())
	defer ghSrv.Close()

	pts, cleanup := newPipelineServer(t, sources, ghSrv.URL)
	defer cleanup()

	// Register a worker that only matches "push" events -- not pull_request.
	w := &workers.Worker{
		Name:     "push-only-worker",
		Endpoint: "http://127.0.0.1:1",
		Events: []workers.EventRule{{
			Source: "github",
			On:     []string{"push"},
			Prompt: "Handle push",
		}},
	}
	if err := pts.Registry.Add(w); err != nil {
		t.Fatalf("registry add: %v", err)
	}
	if err := pts.Registry.Start(w.Name); err != nil {
		t.Fatalf("registry start: %v", err)
	}

	// Send a pull_request webhook -- should not match.
	body := prWebhookPayload("testorg", "testrepo", 5)
	sig := signGitHub(ghSecret, body)

	req, _ := http.NewRequest("POST", "http://"+pts.Addr+"/webhook/github", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-GitHub-Delivery", "delivery-nomatch-001")
	req.Header.Set("X-Hub-Signature-256", sig)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("webhook POST: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != 202 {
		t.Fatalf("expected 202, got %d", resp.StatusCode)
	}

	// Wait for the event to reach "skipped" state.
	deadline := time.After(5 * time.Second)
	for {
		select {
		case <-deadline:
			evs, _ := pts.Events.List(context.Background(), "")
			t.Fatalf("timed out waiting for skipped event; events: %+v", evs)
		default:
			evs, _ := pts.Events.List(context.Background(), "")
			for _, ev := range evs {
				if ev.State == events.StateSkipped {
					return // success
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
}

func TestPipeline_MalformedWebhook(t *testing.T) {
	ghSecret := "malformed-secret"

	sources := source.NewRegistry()
	sources.Register(source.NewGitHubSource(ghSecret, ""))

	rec := &apiRecorder{}
	ghSrv := httptest.NewServer(rec.handler())
	defer ghSrv.Close()

	pts, cleanup := newPipelineServer(t, sources, ghSrv.URL)
	defer cleanup()

	// Send invalid JSON body (still with valid HMAC for the invalid body).
	body := []byte(`{this is not valid json}`)
	sig := signGitHub(ghSecret, body)

	req, _ := http.NewRequest("POST", "http://"+pts.Addr+"/webhook/github", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-GitHub-Delivery", "delivery-malformed-001")
	req.Header.Set("X-Hub-Signature-256", sig)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("webhook POST: %v", err)
	}
	defer resp.Body.Close()

	// The source.Parse will fail on invalid JSON -- should return 401
	// (webhook validation failed) because Parse returns an error.
	if resp.StatusCode != 401 {
		respBody, _ := io.ReadAll(resp.Body)
		t.Errorf("expected 401 for malformed JSON, got %d: %s", resp.StatusCode, respBody)
	}
}

func TestPipeline_InvalidSignature(t *testing.T) {
	ghSecret := "real-secret"

	sources := source.NewRegistry()
	sources.Register(source.NewGitHubSource(ghSecret, ""))

	rec := &apiRecorder{}
	ghSrv := httptest.NewServer(rec.handler())
	defer ghSrv.Close()

	pts, cleanup := newPipelineServer(t, sources, ghSrv.URL)
	defer cleanup()

	body := prWebhookPayload("testorg", "testrepo", 1)
	// Compute HMAC with the wrong secret.
	badSig := signGitHub("wrong-secret", body)

	req, _ := http.NewRequest("POST", "http://"+pts.Addr+"/webhook/github", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-GitHub-Delivery", "delivery-badsig-001")
	req.Header.Set("X-Hub-Signature-256", badSig)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("webhook POST: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 401 {
		respBody, _ := io.ReadAll(resp.Body)
		t.Errorf("expected 401, got %d: %s", resp.StatusCode, respBody)
	}
}
