package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"mecha.im/internal/events"
	"mecha.im/internal/policies"
	"mecha.im/internal/serve"
	"mecha.im/internal/source"
	"mecha.im/internal/store"
	"mecha.im/internal/tasks"
	"mecha.im/internal/workers"
)

// ghAPICall records a single call to the mock GitHub API.
type ghAPICall struct {
	Method string
	Path   string
	Body   string
}

// mockGitHubAPI creates a mock GitHub API server that records all calls.
func mockGitHubAPI(t *testing.T) (*httptest.Server, *[]ghAPICall, *sync.Mutex) {
	t.Helper()
	var calls []ghAPICall
	var mu sync.Mutex

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := ""
		if r.Body != nil {
			b, _ := readBody(r)
			body = string(b)
		}
		mu.Lock()
		calls = append(calls, ghAPICall{
			Method: r.Method,
			Path:   r.URL.Path,
			Body:   body,
		})
		mu.Unlock()
		w.WriteHeader(200)
		w.Write([]byte(`{}`))
	}))
	return srv, &calls, &mu
}

func readBody(r *http.Request) ([]byte, error) {
	if r.Body == nil {
		return nil, nil
	}
	defer r.Body.Close()
	return io.ReadAll(r.Body)
}

// startPolicyTestServer creates a server with a mock worker that returns
// the given result, with the specified policy, and a mock GitHub API for
// write-back verification.
func startPolicyTestServer(
	t *testing.T,
	workerResult string,
	policyConfig map[string]any,
	ghSrv *httptest.Server,
) (serverURL string, cleanup func()) {
	t.Helper()

	dbPath := tempDBPath(t)
	db, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}

	// Create mock worker.
	mockW := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		if r.URL.Path == "/task" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(workerResult))
			return
		}
		w.WriteHeader(404)
	}))
	t.Cleanup(mockW.Close)

	reg, err := workers.NewRegistry(db)
	if err != nil {
		t.Fatalf("create registry: %v", err)
	}

	wk := &workers.Worker{
		Name:     "policy-worker",
		Endpoint: mockW.URL,
		Timeout:  30 * time.Second,
		Policy:   policyConfig,
		Events: []workers.EventRule{
			{
				Source: "github",
				On:     []string{"pull_request.opened"},
				Prompt: "Review PR #{{.number}}",
			},
		},
	}
	if err := reg.Add(wk); err != nil {
		t.Fatalf("add worker: %v", err)
	}
	if err := reg.Start(wk.Name); err != nil {
		t.Fatalf("start worker: %v", err)
	}

	taskStore := tasks.NewStore(db)
	evStore := events.NewStore(db)

	srcReg := source.NewRegistry()
	ghSrc := source.NewGitHubSource("test-secret", "fake-token")
	srcReg.Register(ghSrc)

	// Register a mock responder that calls our mock GitHub API.
	if ghSrv != nil {
		responder := &mockResponder{
			name:    "github",
			baseURL: ghSrv.URL,
			t:       t,
		}
		srcReg.RegisterResponder(responder)
	}

	port := findFreePort(t)
	addr := fmt.Sprintf("127.0.0.1:%d", port)

	srv := serve.New(serve.Config{
		Registry: reg,
		Tasks:    taskStore,
		Events:   evStore,
		Sources:  srcReg,
		Addr:     addr,
	})

	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() { errCh <- srv.Start(ctx) }()

	serverURL = fmt.Sprintf("http://%s", addr)
	waitForServerHealth(t, serverURL, 5*time.Second)

	cleanup = func() {
		cancel()
		<-errCh
		db.Close()
	}
	return serverURL, cleanup
}

// mockResponder implements source.Responder for testing policy enforcement
// in the full pipeline.
type mockResponder struct {
	name    string
	baseURL string
	t       *testing.T
	mu      sync.Mutex
	calls   []responderCall
}

type responderCall struct {
	EventID string
	Result  policies.Result
}

func (m *mockResponder) Name() string { return m.name }

func (m *mockResponder) Respond(_ context.Context, ev *events.Event, res policies.Result) error {
	m.mu.Lock()
	m.calls = append(m.calls, responderCall{EventID: ev.ID, Result: res})
	m.mu.Unlock()

	// Forward to the mock GitHub API for recording.
	owner, _ := ev.Attrs["repo_owner"].(string)
	repo, _ := ev.Attrs["repo_name"].(string)
	number := 0
	if n, ok := ev.Attrs["number"].(int); ok {
		number = n
	}
	if n, ok := ev.Attrs["number"].(float64); ok {
		number = int(n)
	}

	client := &http.Client{Timeout: 5 * time.Second}

	if res.Comment != nil && res.Comment.Body != "" && number > 0 {
		url := fmt.Sprintf("%s/repos/%s/%s/issues/%d/comments", m.baseURL, owner, repo, number)
		body, _ := json.Marshal(map[string]string{"body": res.Comment.Body})
		req, _ := http.NewRequest("POST", url, strings.NewReader(string(body)))
		client.Do(req)
	}
	if res.Labels != nil {
		for _, label := range res.Labels.Add {
			url := fmt.Sprintf("%s/repos/%s/%s/issues/%d/labels", m.baseURL, owner, repo, number)
			body, _ := json.Marshal(map[string]string{"name": label})
			req, _ := http.NewRequest("POST", url, strings.NewReader(string(body)))
			client.Do(req)
		}
	}
	if res.Status != nil && res.Status.State != "" {
		url := fmt.Sprintf("%s/repos/%s/%s/statuses/abc123", m.baseURL, owner, repo)
		body, _ := json.Marshal(map[string]string{"state": res.Status.State})
		req, _ := http.NewRequest("POST", url, strings.NewReader(string(body)))
		client.Do(req)
	}
	if res.Commit != nil && res.Commit.Diff != "" {
		url := fmt.Sprintf("%s/repos/%s/%s/pulls/%d/comments", m.baseURL, owner, repo, number)
		body, _ := json.Marshal(map[string]string{"body": res.Commit.Diff})
		req, _ := http.NewRequest("POST", url, strings.NewReader(string(body)))
		client.Do(req)
	}
	return nil
}

func (m *mockResponder) getCalls() []responderCall {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := make([]responderCall, len(m.calls))
	copy(cp, m.calls)
	return cp
}

// sendGitHubWebhook sends a webhook to the mecha server and returns the event ID.
func sendGitHubWebhook(t *testing.T, serverURL, secret string) string {
	t.Helper()
	payload := `{
		"action": "opened",
		"number": 42,
		"pull_request": {
			"number": 42,
			"title": "Test PR",
			"body": "Test body",
			"head": {"sha": "abc123", "ref": "feature"},
			"base": {"ref": "main", "sha": "def456"}
		},
		"sender": {"login": "testuser"},
		"repository": {"full_name": "owner/repo"}
	}`
	body := []byte(payload)
	sig := signGitHub(secret, body)

	req, _ := http.NewRequest("POST", serverURL+"/webhook/github", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-GitHub-Delivery", fmt.Sprintf("del-%d", time.Now().UnixNano()))
	req.Header.Set("X-Hub-Signature-256", sig)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("webhook request: %v", err)
	}
	defer resp.Body.Close()
	var result map[string]any
	json.NewDecoder(resp.Body).Decode(&result)
	id, _ := result["id"].(string)
	return id
}

// waitForEventComplete polls until the event reaches completed state.
func waitForEventComplete(t *testing.T, serverURL, eventID string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		body, status := apiGet(t, serverURL, "/event/"+eventID)
		if status == 200 {
			var ev map[string]any
			json.Unmarshal(body, &ev)
			state, _ := ev["state"].(string)
			if state == "completed" || state == "failed" {
				return
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("event %s did not complete within %v", eventID, timeout)
}

func TestPolicy_LabelAllowlistEnforced(t *testing.T) {
	ghSrv, calls, mu := mockGitHubAPI(t)
	defer ghSrv.Close()

	workerResult := `{
		"output": "review done",
		"labels": {"add": ["bug", "approved", "urgent"]}
	}`
	policyConfig := map[string]any{
		"labels": map[string]any{
			"allow":   true,
			"allowed": []any{"bug"},
		},
	}

	serverURL, cleanup := startPolicyTestServer(t, workerResult, policyConfig, ghSrv)
	defer cleanup()

	eventID := sendGitHubWebhook(t, serverURL, "test-secret")
	if eventID == "" {
		t.Fatal("no event ID returned")
	}
	waitForEventComplete(t, serverURL, eventID, 15*time.Second)

	// Check which labels were sent to the mock GitHub API.
	mu.Lock()
	defer mu.Unlock()
	labelCalls := 0
	for _, c := range *calls {
		if strings.Contains(c.Path, "/labels") {
			labelCalls++
			// Only "bug" should be in the label calls.
			if !strings.Contains(c.Body, "bug") {
				t.Errorf("unexpected label call body: %s", c.Body)
			}
			if strings.Contains(c.Body, "approved") {
				t.Errorf("policy should have blocked 'approved' label")
			}
			if strings.Contains(c.Body, "urgent") {
				t.Errorf("policy should have blocked 'urgent' label (not in allowlist)")
			}
		}
	}
	if labelCalls != 1 {
		t.Errorf("expected 1 label API call (bug only), got %d", labelCalls)
	}
}

func TestPolicy_CaseInsensitiveBlocking(t *testing.T) {
	ghSrv, calls, mu := mockGitHubAPI(t)
	defer ghSrv.Close()

	workerResult := `{
		"output": "review done",
		"labels": {"add": ["Approved", "Bug"]}
	}`
	policyConfig := map[string]any{
		"labels": map[string]any{
			"allow":   true,
			"blocked": []any{"approved"},
		},
	}

	serverURL, cleanup := startPolicyTestServer(t, workerResult, policyConfig, ghSrv)
	defer cleanup()

	eventID := sendGitHubWebhook(t, serverURL, "test-secret")
	if eventID == "" {
		t.Fatal("no event ID returned")
	}
	waitForEventComplete(t, serverURL, eventID, 15*time.Second)

	mu.Lock()
	defer mu.Unlock()
	for _, c := range *calls {
		if strings.Contains(c.Path, "/labels") {
			if strings.Contains(strings.ToLower(c.Body), "approved") {
				t.Errorf("policy should have blocked 'Approved' (case-insensitive); body = %s", c.Body)
			}
		}
	}
}

func TestPolicy_MetadataRedacted(t *testing.T) {
	ghSrv, calls, mu := mockGitHubAPI(t)
	defer ghSrv.Close()

	workerResult := `{
		"output": "review done",
		"comment": {"target": "pr:42", "body": "Looks good"},
		"metadata": {"model": "secret-model", "input_tokens": 5000}
	}`
	policyConfig := map[string]any{
		"comment": map[string]any{
			"allow": true,
		},
		"metadata": map[string]any{
			"allow": false,
		},
	}

	serverURL, cleanup := startPolicyTestServer(t, workerResult, policyConfig, ghSrv)
	defer cleanup()

	eventID := sendGitHubWebhook(t, serverURL, "test-secret")
	if eventID == "" {
		t.Fatal("no event ID returned")
	}
	waitForEventComplete(t, serverURL, eventID, 15*time.Second)

	// The comment should go through but metadata should not appear in any API call.
	mu.Lock()
	defer mu.Unlock()
	commentSent := false
	for _, c := range *calls {
		if strings.Contains(c.Body, "secret-model") {
			t.Errorf("metadata should be redacted; found 'secret-model' in call: %s %s body=%s", c.Method, c.Path, c.Body)
		}
		if strings.Contains(c.Path, "/comments") && strings.Contains(c.Body, "Looks good") {
			commentSent = true
		}
	}
	if !commentSent {
		t.Errorf("comment should have been sent to GitHub API; calls = %v", *calls)
	}
}

func TestPolicy_CommitDiffSizeLimit(t *testing.T) {
	ghSrv, calls, mu := mockGitHubAPI(t)
	defer ghSrv.Close()

	// 500-byte diff exceeds 100-byte max_size.
	largeDiff := strings.Repeat("x", 500)
	workerResult := fmt.Sprintf(`{
		"output": "changes needed",
		"commit": {"message": "fix bug", "diff": "%s"}
	}`, largeDiff)

	policyConfig := map[string]any{
		"commit": map[string]any{
			"allow":    true,
			"max_size": 100,
		},
	}

	serverURL, cleanup := startPolicyTestServer(t, workerResult, policyConfig, ghSrv)
	defer cleanup()

	eventID := sendGitHubWebhook(t, serverURL, "test-secret")
	if eventID == "" {
		t.Fatal("no event ID returned")
	}
	waitForEventComplete(t, serverURL, eventID, 15*time.Second)

	// Commit should NOT be written back (diff too large).
	mu.Lock()
	defer mu.Unlock()
	for _, c := range *calls {
		if strings.Contains(c.Path, "/pulls/") && strings.Contains(c.Path, "/comments") {
			t.Errorf("commit should have been blocked by size limit; found call: %s %s", c.Method, c.Path)
		}
	}
}

func TestPolicy_StatusStateValidation(t *testing.T) {
	ghSrv, calls, mu := mockGitHubAPI(t)
	defer ghSrv.Close()

	workerResult := `{
		"output": "check done",
		"status": {"state": "INVALID", "description": "bad state"}
	}`
	policyConfig := map[string]any{
		"status": map[string]any{
			"allow": true,
		},
	}

	serverURL, cleanup := startPolicyTestServer(t, workerResult, policyConfig, ghSrv)
	defer cleanup()

	eventID := sendGitHubWebhook(t, serverURL, "test-secret")
	if eventID == "" {
		t.Fatal("no event ID returned")
	}
	waitForEventComplete(t, serverURL, eventID, 15*time.Second)

	// Status with invalid state should NOT be posted.
	mu.Lock()
	defer mu.Unlock()
	for _, c := range *calls {
		if strings.Contains(c.Path, "/statuses/") {
			t.Errorf("status with invalid state should not be posted; found call: %s %s body=%s", c.Method, c.Path, c.Body)
		}
	}
}

func TestPolicy_AllDenied(t *testing.T) {
	ghSrv, calls, mu := mockGitHubAPI(t)
	defer ghSrv.Close()

	workerResult := `{
		"output": "full result",
		"comment": {"target": "pr:42", "body": "should not appear"},
		"labels": {"add": ["bug"]},
		"status": {"state": "success", "description": "passed"},
		"commit": {"message": "fix", "diff": "--- a/f\n+++ b/f"},
		"metadata": {"model": "test"}
	}`
	policyConfig := map[string]any{
		"comment":  map[string]any{"allow": false},
		"labels":   map[string]any{"allow": false},
		"status":   map[string]any{"allow": false},
		"commit":   map[string]any{"allow": false},
		"metadata": map[string]any{"allow": false},
	}

	serverURL, cleanup := startPolicyTestServer(t, workerResult, policyConfig, ghSrv)
	defer cleanup()

	eventID := sendGitHubWebhook(t, serverURL, "test-secret")
	if eventID == "" {
		t.Fatal("no event ID returned")
	}
	waitForEventComplete(t, serverURL, eventID, 15*time.Second)

	// Zero API calls should reach the mock GitHub API.
	mu.Lock()
	defer mu.Unlock()
	if len(*calls) != 0 {
		t.Errorf("expected zero GitHub API calls with all-deny policy; got %d calls:", len(*calls))
		for _, c := range *calls {
			t.Logf("  %s %s body=%s", c.Method, c.Path, c.Body)
		}
	}
}
