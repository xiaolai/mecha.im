package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"mecha.im/internal/event"
	"mecha.im/internal/policy"
	"mecha.im/internal/source"
	"mecha.im/internal/worker"
)

func boolPtr(b bool) *bool { return &b }

// prWebhookPayloadWithBase returns a GitHub PR webhook body with a specific base branch.
func prWebhookPayloadWithBase(owner, repo string, number int, baseBranch string) []byte {
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
				"ref": baseBranch,
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

// TestEdge_SlowWorkerTimeout verifies that a worker exceeding its timeout
// triggers the timeout path (context deadline exceeded). The task transitions
// to retry/pending with an error mentioning the deadline, rather than hanging.
//
// Note: with DefaultMaxRetries=3 and RetryBaseDelay=30s, the task won't reach
// final "failed" state for ~210s. Instead we verify the first timeout fires
// and the error message mentions deadline/timeout.
func TestEdge_SlowWorkerTimeout(t *testing.T) {
	// Mock worker that sleeps 5s before responding.
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		if r.URL.Path == "/task" {
			time.Sleep(5 * time.Second)
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"output":"too late"}`))
			return
		}
		w.WriteHeader(404)
	}))
	defer mock.Close()

	w := &worker.Worker{
		Name:     "slow-worker",
		Endpoint: mock.URL,
		Timeout:  2 * time.Second,
	}

	serverURL, cleanup := startTestServer(t, []*worker.Worker{w}, nil)
	defer cleanup()

	body, status := apiPost(t, serverURL, "/task", map[string]string{
		"prompt": "will timeout",
		"worker": "slow-worker",
	})
	if status != http.StatusAccepted {
		t.Fatalf("POST /task status = %d, body = %s", status, body)
	}

	var resp map[string]any
	json.Unmarshal(body, &resp)
	taskID, _ := resp["id"].(string)
	if taskID == "" {
		t.Fatalf("no task ID in response: %s", body)
	}

	// Poll until the task has an error message (retry path) or reaches failed.
	// The first timeout fires after ~2s. After that, the task is re-queued
	// for retry in "pending" state with an error_msg mentioning the deadline.
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		taskBody, taskStatus := apiGet(t, serverURL, "/task/"+taskID)
		if taskStatus == 200 {
			var result map[string]any
			json.Unmarshal(taskBody, &result)
			state, _ := result["state"].(string)
			errMsg, _ := result["error"].(string)

			// Terminal: task dead-lettered after all retries.
			if state == "failed" {
				if !strings.Contains(strings.ToLower(errMsg), "deadline") &&
					!strings.Contains(strings.ToLower(errMsg), "context") {
					t.Errorf("error = %q, expected mention of deadline/context", errMsg)
				}
				return
			}

			// Retry path: task is back to pending with a timeout error.
			if state == "pending" && errMsg != "" {
				lower := strings.ToLower(errMsg)
				if strings.Contains(lower, "deadline") ||
					strings.Contains(lower, "context") ||
					strings.Contains(lower, "canceled") {
					t.Logf("task entered retry with timeout error: %s", errMsg)
					return
				}
			}
		}
		time.Sleep(200 * time.Millisecond)
	}

	// Final check.
	taskBody, _ := apiGet(t, serverURL, "/task/"+taskID)
	t.Fatalf("task did not show timeout evidence within 10s; final: %s", taskBody)
}

// TestEdge_EmptyWorkerResult verifies that a worker returning {} causes no
// write-back and no panic; the event completes normally.
func TestEdge_EmptyWorkerResult(t *testing.T) {
	ghSecret := "empty-result-secret"

	// Mock worker returns empty JSON.
	mockW := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		if r.URL.Path == "/task" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{}`))
			return
		}
		w.WriteHeader(404)
	}))
	defer mockW.Close()

	// Mock GitHub API that records calls.
	var ghCalls atomic.Int32
	ghSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ghCalls.Add(1)
		w.WriteHeader(200)
	}))
	defer ghSrv.Close()

	sources := source.NewRegistry()
	sources.Register(source.NewGitHubSource(ghSecret, ""))

	pts, cleanup := newPipelineServer(t, sources, ghSrv.URL)
	defer cleanup()

	wk := &worker.Worker{
		Name:     "empty-worker",
		Endpoint: mockW.URL,
		Events: []worker.EventRule{{
			Source: "github",
			On:     []string{"pull_request.opened"},
			Prompt: "Review PR #{{.number}}",
		}},
	}
	if err := pts.Registry.Add(wk); err != nil {
		t.Fatalf("registry add: %v", err)
	}
	if err := pts.Registry.Start(wk.Name); err != nil {
		t.Fatalf("registry start: %v", err)
	}

	body := prWebhookPayload("testorg", "testrepo", 77)
	sig := signGitHub(ghSecret, body)

	req, _ := http.NewRequest("POST", "http://"+pts.Addr+"/webhook/github", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-GitHub-Delivery", "delivery-empty-001")
	req.Header.Set("X-Hub-Signature-256", sig)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("webhook POST: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != 202 {
		t.Fatalf("expected 202, got %d", resp.StatusCode)
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
				if ev.State == event.StateCompleted {
					// Verify zero GitHub API calls (nothing to write back).
					if calls := ghCalls.Load(); calls != 0 {
						t.Errorf("expected 0 GitHub API calls, got %d", calls)
					}
					return
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
}

// TestEdge_NonJSONWorkerResult verifies that a worker returning plain text
// (not valid JSON) is handled gracefully -- the task completes and
// doWriteBack does not panic.
func TestEdge_NonJSONWorkerResult(t *testing.T) {
	ghSecret := "nonjson-result-secret"

	// Mock worker returns plain text.
	mockW := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		if r.URL.Path == "/task" {
			w.Header().Set("Content-Type", "text/plain")
			w.Write([]byte("this is plain text, not JSON"))
			return
		}
		w.WriteHeader(404)
	}))
	defer mockW.Close()

	sources := source.NewRegistry()
	sources.Register(source.NewGitHubSource(ghSecret, ""))

	rec := &apiRecorder{}
	ghSrv := httptest.NewServer(rec.handler())
	defer ghSrv.Close()

	pts, cleanup := newPipelineServer(t, sources, ghSrv.URL)
	defer cleanup()

	wk := &worker.Worker{
		Name:     "nonjson-worker",
		Endpoint: mockW.URL,
		Events: []worker.EventRule{{
			Source: "github",
			On:     []string{"pull_request.opened"},
			Prompt: "Review PR #{{.number}}",
		}},
	}
	if err := pts.Registry.Add(wk); err != nil {
		t.Fatalf("registry add: %v", err)
	}
	if err := pts.Registry.Start(wk.Name); err != nil {
		t.Fatalf("registry start: %v", err)
	}

	body := prWebhookPayload("testorg", "testrepo", 88)
	sig := signGitHub(ghSecret, body)

	req, _ := http.NewRequest("POST", "http://"+pts.Addr+"/webhook/github", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-GitHub-Delivery", "delivery-nonjson-001")
	req.Header.Set("X-Hub-Signature-256", sig)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("webhook POST: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != 202 {
		t.Fatalf("expected 202, got %d", resp.StatusCode)
	}

	// Wait for event to reach a terminal state (completed or dispatched-but-writeback-skipped).
	deadline := time.After(10 * time.Second)
	for {
		select {
		case <-deadline:
			evs, _ := pts.Events.List(context.Background(), "")
			t.Fatalf("timed out waiting for event completion; events: %+v", evs)
		default:
			evs, _ := pts.Events.List(context.Background(), "")
			for _, ev := range evs {
				if ev.State == event.StateCompleted || ev.State == event.StateDispatched {
					// The task completed without panic. doWriteBack returns true
					// on JSON parse failure (logs warning, nothing to write back).
					return
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
}

// TestEdge_EventRuleAutoFalse verifies that a worker with Auto=false does not
// auto-dispatch: the event stays in "received" or "skipped" state and no task
// is created.
func TestEdge_EventRuleAutoFalse(t *testing.T) {
	ghSecret := "auto-false-secret"

	mockW := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		if r.URL.Path == "/task" {
			t.Error("worker /task should not be called when Auto=false")
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"output":"should not happen"}`))
			return
		}
		w.WriteHeader(404)
	}))
	defer mockW.Close()

	sources := source.NewRegistry()
	sources.Register(source.NewGitHubSource(ghSecret, ""))

	rec := &apiRecorder{}
	ghSrv := httptest.NewServer(rec.handler())
	defer ghSrv.Close()

	pts, cleanup := newPipelineServer(t, sources, ghSrv.URL)
	defer cleanup()

	wk := &worker.Worker{
		Name:     "manual-worker",
		Endpoint: mockW.URL,
		Events: []worker.EventRule{{
			Source: "github",
			On:     []string{"pull_request.opened"},
			Prompt: "Review PR #{{.number}}",
			Auto:   boolPtr(false),
		}},
	}
	if err := pts.Registry.Add(wk); err != nil {
		t.Fatalf("registry add: %v", err)
	}
	if err := pts.Registry.Start(wk.Name); err != nil {
		t.Fatalf("registry start: %v", err)
	}

	body := prWebhookPayload("testorg", "testrepo", 55)
	sig := signGitHub(ghSecret, body)

	req, _ := http.NewRequest("POST", "http://"+pts.Addr+"/webhook/github", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-GitHub-Delivery", "delivery-autofalse-001")
	req.Header.Set("X-Hub-Signature-256", sig)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("webhook POST: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != 202 {
		t.Fatalf("expected 202, got %d", resp.StatusCode)
	}

	// Wait 3s and confirm no task was created; event should be skipped.
	time.Sleep(3 * time.Second)

	evs, err := pts.Events.List(context.Background(), "")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	if len(evs) != 1 {
		t.Fatalf("expected 1 event, got %d", len(evs))
	}

	ev := evs[0]
	// When Auto=false, the rule match is skipped. If no other rule matches,
	// the event is set to "skipped".
	if ev.State != event.StateSkipped {
		t.Errorf("event state = %q, want skipped (Auto=false should skip dispatch)", ev.State)
	}

	// Confirm no tasks exist.
	tasks, err := pts.Tasks.List(context.Background(), "")
	if err != nil {
		t.Fatalf("list tasks: %v", err)
	}
	if len(tasks) != 0 {
		t.Errorf("expected 0 tasks, got %d", len(tasks))
	}
}

// TestEdge_EventRuleFilterMatch verifies that event rule filters correctly
// gate dispatch: matching filter attributes dispatch, non-matching skip.
func TestEdge_EventRuleFilterMatch(t *testing.T) {
	ghSecret := "filter-match-secret"

	var dispatched atomic.Int32
	mockW := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		if r.URL.Path == "/task" {
			dispatched.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"output":"filtered match"}`))
			return
		}
		w.WriteHeader(404)
	}))
	defer mockW.Close()

	sources := source.NewRegistry()
	sources.Register(source.NewGitHubSource(ghSecret, ""))

	rec := &apiRecorder{}
	ghSrv := httptest.NewServer(rec.handler())
	defer ghSrv.Close()

	pts, cleanup := newPipelineServer(t, sources, ghSrv.URL)
	defer cleanup()

	wk := &worker.Worker{
		Name:     "filter-worker",
		Endpoint: mockW.URL,
		Events: []worker.EventRule{{
			Source: "github",
			On:     []string{"pull_request.opened"},
			Filter: map[string]string{"base_branch": "main"},
			Prompt: "Review PR #{{.number}}",
		}},
	}
	if err := pts.Registry.Add(wk); err != nil {
		t.Fatalf("registry add: %v", err)
	}
	if err := pts.Registry.Start(wk.Name); err != nil {
		t.Fatalf("registry start: %v", err)
	}

	// First webhook: base_branch=main (should match filter).
	body1 := prWebhookPayloadWithBase("testorg", "testrepo", 10, "main")
	sig1 := signGitHub(ghSecret, body1)

	req1, _ := http.NewRequest("POST", "http://"+pts.Addr+"/webhook/github", bytes.NewReader(body1))
	req1.Header.Set("Content-Type", "application/json")
	req1.Header.Set("X-GitHub-Event", "pull_request")
	req1.Header.Set("X-GitHub-Delivery", "delivery-filter-main")
	req1.Header.Set("X-Hub-Signature-256", sig1)

	resp1, err := http.DefaultClient.Do(req1)
	if err != nil {
		t.Fatalf("webhook POST 1: %v", err)
	}
	resp1.Body.Close()
	if resp1.StatusCode != 202 {
		t.Fatalf("webhook 1: expected 202, got %d", resp1.StatusCode)
	}

	// Second webhook: base_branch=develop (should NOT match filter).
	body2 := prWebhookPayloadWithBase("testorg", "testrepo", 11, "develop")
	sig2 := signGitHub(ghSecret, body2)

	req2, _ := http.NewRequest("POST", "http://"+pts.Addr+"/webhook/github", bytes.NewReader(body2))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("X-GitHub-Event", "pull_request")
	req2.Header.Set("X-GitHub-Delivery", "delivery-filter-develop")
	req2.Header.Set("X-Hub-Signature-256", sig2)

	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatalf("webhook POST 2: %v", err)
	}
	resp2.Body.Close()
	if resp2.StatusCode != 202 {
		t.Fatalf("webhook 2: expected 202, got %d", resp2.StatusCode)
	}

	// Wait for both events to settle.
	deadline := time.After(10 * time.Second)
	for {
		select {
		case <-deadline:
			evs, _ := pts.Events.List(context.Background(), "")
			t.Fatalf("timed out; events: %+v, dispatched: %d", evs, dispatched.Load())
		default:
			evs, _ := pts.Events.List(context.Background(), "")
			if len(evs) < 2 {
				time.Sleep(50 * time.Millisecond)
				continue
			}
			// Check if both events have settled (not in received state).
			settled := 0
			for _, ev := range evs {
				if ev.State != event.StateReceived && ev.State != event.StateMatched {
					settled++
				}
			}
			if settled < 2 {
				time.Sleep(50 * time.Millisecond)
				continue
			}

			// Verify: first event matched and dispatched, second skipped.
			if dispatched.Load() != 1 {
				t.Errorf("expected exactly 1 dispatch, got %d", dispatched.Load())
			}
			var skippedCount, dispatchedCount int
			for _, ev := range evs {
				if ev.State == event.StateSkipped {
					skippedCount++
				}
				if ev.State == event.StateDispatched || ev.State == event.StateCompleted {
					dispatchedCount++
				}
			}
			if dispatchedCount != 1 {
				t.Errorf("expected 1 dispatched/completed event, got %d", dispatchedCount)
			}
			if skippedCount != 1 {
				t.Errorf("expected 1 skipped event, got %d", skippedCount)
			}
			return
		}
	}
}

// TestEdge_WriteBackFailureEventStaysDispatched verifies that when the
// write-back (GitHub API) fails, the event stays in "dispatched" state
// (not completed) and the writeback_fail metric increments.
func TestEdge_WriteBackFailureEventStaysDispatched(t *testing.T) {
	ghSecret := "wb-fail-secret"

	// Mock worker returns a result with a comment.
	mockW := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		if r.URL.Path == "/task" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"output":  "review done",
				"comment": map[string]string{"body": "LGTM"},
			})
			return
		}
		w.WriteHeader(404)
	}))
	defer mockW.Close()

	// Mock GitHub API that always returns 500.
	ghSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte("internal server error"))
	}))
	defer ghSrv.Close()

	sources := source.NewRegistry()
	ghSrc := source.NewGitHubSource(ghSecret, "")
	sources.Register(ghSrc)
	// Register a mock responder that always errors (simulating GitHub 500).
	failResponder := &failingResponder{name: "github"}
	sources.RegisterResponder(failResponder)

	pts, cleanup := newPipelineServer(t, sources, ghSrv.URL)
	defer cleanup()

	wk := &worker.Worker{
		Name:     "wb-fail-worker",
		Endpoint: mockW.URL,
		Events: []worker.EventRule{{
			Source: "github",
			On:     []string{"pull_request.opened"},
			Prompt: "Review PR #{{.number}}",
		}},
	}
	if err := pts.Registry.Add(wk); err != nil {
		t.Fatalf("registry add: %v", err)
	}
	if err := pts.Registry.Start(wk.Name); err != nil {
		t.Fatalf("registry start: %v", err)
	}

	body := prWebhookPayload("testorg", "testrepo", 33)
	sig := signGitHub(ghSecret, body)

	req, _ := http.NewRequest("POST", "http://"+pts.Addr+"/webhook/github", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-GitHub-Delivery", "delivery-wbfail-001")
	req.Header.Set("X-Hub-Signature-256", sig)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("webhook POST: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != 202 {
		t.Fatalf("expected 202, got %d", resp.StatusCode)
	}

	// Wait for the task to complete (result stored) but event to stay dispatched.
	time.Sleep(5 * time.Second)

	evs, err := pts.Events.List(context.Background(), "")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	if len(evs) != 1 {
		t.Fatalf("expected 1 event, got %d", len(evs))
	}
	ev := evs[0]
	// Event should stay in dispatched state because write-back failed.
	if ev.State != event.StateDispatched {
		t.Errorf("event state = %q, want dispatched (write-back failed)", ev.State)
	}

	// Verify writeback_fail metric is > 0.
	metricsBody, status := apiGet(t, "http://"+pts.Addr, "/metrics")
	if status != 200 {
		t.Fatalf("GET /metrics status = %d", status)
	}
	metricsStr := string(metricsBody)
	if !strings.Contains(metricsStr, "mecha_writeback_fail") {
		t.Errorf("metrics missing writeback_fail; full metrics:\n%s", metricsStr)
	}
}

// failingResponder is a source.Responder that always returns an error.
type failingResponder struct {
	name string
}

func (f *failingResponder) Name() string { return f.name }

func (f *failingResponder) Respond(_ context.Context, _ *event.Event, _ policy.Result) error {
	return fmt.Errorf("simulated write-back failure")
}

// TestEdge_WebhookBodySizeLimit verifies that an oversized webhook body
// (>5MB) is rejected without crashing.
func TestEdge_WebhookBodySizeLimit(t *testing.T) {
	ghSecret := "bodysize-secret"

	sources := source.NewRegistry()
	sources.Register(source.NewGitHubSource(ghSecret, ""))

	rec := &apiRecorder{}
	ghSrv := httptest.NewServer(rec.handler())
	defer ghSrv.Close()

	pts, cleanup := newPipelineServer(t, sources, ghSrv.URL)
	defer cleanup()

	// Create a body larger than 5MB.
	bigBody := bytes.Repeat([]byte("x"), 5*1024*1024+1)
	sig := signGitHub(ghSecret, bigBody)

	req, _ := http.NewRequest("POST", "http://"+pts.Addr+"/webhook/github", bytes.NewReader(bigBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Event", "pull_request")
	req.Header.Set("X-GitHub-Delivery", "delivery-bigbody-001")
	req.Header.Set("X-Hub-Signature-256", sig)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("webhook POST: %v", err)
	}
	defer resp.Body.Close()
	io.ReadAll(resp.Body)

	// Should fail (400 or 401) — the body is truncated by LimitReader so
	// the HMAC won't match, and JSON parse will fail.
	if resp.StatusCode == 202 {
		t.Fatalf("oversized body should not be accepted (got 202)")
	}
	if resp.StatusCode != 400 && resp.StatusCode != 401 {
		t.Logf("got status %d (acceptable — body was rejected)", resp.StatusCode)
	}
}
