package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// ---------- handleSSE ----------

func TestHandleSSE(t *testing.T) {
	req := httptest.NewRequest("GET", "/sse", nil)
	ctx, cancel := context.WithTimeout(req.Context(), 200*time.Millisecond)
	defer cancel()
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	handleSSE(w, req)

	resp := w.Result()
	if resp.Header.Get("Content-Type") != "text/event-stream" {
		t.Errorf("Content-Type = %q, want text/event-stream", resp.Header.Get("Content-Type"))
	}
	body := w.Body.String()
	if !strings.Contains(body, "event: endpoint") {
		t.Errorf("body should contain 'event: endpoint', got %q", body)
	}
	if !strings.Contains(body, "data: /message?session=") {
		t.Errorf("body should contain session endpoint, got %q", body)
	}
}

func TestHandleSSENotFlushable(t *testing.T) {
	req := httptest.NewRequest("GET", "/sse", nil)
	w := &nonFlushWriter{header: http.Header{}}
	handleSSE(w, req)
	if w.code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", w.code)
	}
}

type nonFlushWriter struct {
	header http.Header
	code   int
	body   strings.Builder
}

func (w *nonFlushWriter) Header() http.Header         { return w.header }
func (w *nonFlushWriter) WriteHeader(code int)         { w.code = code }
func (w *nonFlushWriter) Write(b []byte) (int, error)  { return w.body.Write(b) }

// ---------- handleMessage ----------

func TestHandleMessageValidRequest(t *testing.T) {
	msg := mcpRequest{
		JSONRPC: "2.0",
		ID:      ptrJSON(1),
		Method:  "tools/list",
	}
	body, _ := json.Marshal(msg)

	req := httptest.NewRequest("POST", "/message?session=s-1", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handleMessage(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
	var resp mcpResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Error != nil {
		t.Errorf("unexpected error: %v", resp.Error)
	}
}

func TestHandleMessageMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest("GET", "/message", nil)
	w := httptest.NewRecorder()
	handleMessage(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", w.Code)
	}
}

func TestHandleMessageInvalidJSON(t *testing.T) {
	req := httptest.NewRequest("POST", "/message", strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handleMessage(w, req)

	var resp mcpResponse
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Error == nil || resp.Error.Code != -32700 {
		t.Errorf("expected parse error (-32700), got %+v", resp.Error)
	}
}

func TestHandleMessageNotification(t *testing.T) {
	msg := mcpRequest{JSONRPC: "2.0", Method: "notifications/initialized"}
	body, _ := json.Marshal(msg)

	req := httptest.NewRequest("POST", "/message", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handleMessage(w, req)

	if w.Code != http.StatusAccepted {
		t.Errorf("status = %d, want 202", w.Code)
	}
}

// ---------- handleWebhook ----------

func TestHandleWebhookMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest("GET", "/webhook", nil)
	w := httptest.NewRecorder()
	handleWebhook(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", w.Code)
	}
}

func TestHandleWebhookNoSecret(t *testing.T) {
	old := webhookSecret
	webhookSecret = ""
	defer func() { webhookSecret = old }()

	req := httptest.NewRequest("POST", "/webhook", strings.NewReader("{}"))
	w := httptest.NewRecorder()
	handleWebhook(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", w.Code)
	}
}

func TestHandleWebhookInvalidSignature(t *testing.T) {
	old := webhookSecret
	webhookSecret = "test-secret"
	defer func() { webhookSecret = old }()

	req := httptest.NewRequest("POST", "/webhook", strings.NewReader("{}"))
	req.Header.Set("X-Hub-Signature-256", "sha256=invalid")
	w := httptest.NewRecorder()
	handleWebhook(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", w.Code)
	}
}

func TestHandleWebhookNonPushEvent(t *testing.T) {
	old := webhookSecret
	webhookSecret = "test-secret"
	defer func() { webhookSecret = old }()

	body := []byte(`{"ref":"refs/heads/main"}`)
	sig := signBody("test-secret", body)

	req := httptest.NewRequest("POST", "/webhook", strings.NewReader(string(body)))
	req.Header.Set("X-Hub-Signature-256", sig)
	req.Header.Set("X-GitHub-Event", "pull_request")
	w := httptest.NewRecorder()
	handleWebhook(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
}

func TestHandleWebhookPushNoDocs(t *testing.T) {
	old := webhookSecret
	webhookSecret = "test-secret"
	defer func() { webhookSecret = old }()

	body := []byte(`{"commits":[{"added":["src/main.go"],"modified":[],"removed":[]}]}`)
	sig := signBody("test-secret", body)

	req := httptest.NewRequest("POST", "/webhook", strings.NewReader(string(body)))
	req.Header.Set("X-Hub-Signature-256", sig)
	req.Header.Set("X-GitHub-Event", "push")
	w := httptest.NewRecorder()
	handleWebhook(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
}

func TestHandleWebhookPushWithDocs(t *testing.T) {
	// This test verifies the synchronous webhook path (returns 202).
	// The background goroutine (git pull + reload) is tested implicitly.
	// We set repoDir to a valid git repo and never restore it during the test
	// to avoid a data race with the background goroutine.
	old := webhookSecret
	webhookSecret = "test-secret"
	defer func() { webhookSecret = old }()

	tmpRepo := t.TempDir()
	exec.Command("git", "-C", tmpRepo, "init").Run()
	exec.Command("git", "-C", tmpRepo, "commit", "--allow-empty", "-m", "init").Run()
	repoDir = tmpRepo // not restored — goroutine reads it async

	body := []byte(`{"commits":[{"added":["website/guide/new.md"],"modified":[],"removed":[]}]}`)
	sig := signBody("test-secret", body)

	req := httptest.NewRequest("POST", "/webhook", strings.NewReader(string(body)))
	req.Header.Set("X-Hub-Signature-256", sig)
	req.Header.Set("X-GitHub-Event", "push")
	w := httptest.NewRecorder()
	handleWebhook(w, req)

	if w.Code != http.StatusAccepted {
		t.Errorf("status = %d, want 202", w.Code)
	}
	// Give the goroutine time to finish before test cleanup removes tmpRepo
	time.Sleep(1 * time.Second)
}

// ---------- helpers ----------

func signBody(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func ptrJSON(v int) *json.RawMessage {
	raw := json.RawMessage([]byte(`1`))
	return &raw
}
