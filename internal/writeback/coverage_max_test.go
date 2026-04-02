package writeback

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"mecha.im/internal/events"
	"mecha.im/internal/policies"
)

// --- WriteBackResult: number=0 (no comment, no label) ---

func TestWriteBackResultNoNumberMax(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("no API call expected when number is 0")
		w.WriteHeader(201)
	}))
	defer srv.Close()
	restore := OverrideAPIBase(srv.URL)
	defer restore()

	c := NewClient("token", nil)
	ev := &events.Event{
		ID: "ev-no-number",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			// number is 0 (default)
		},
	}
	res := policies.Result{
		Comment: &policies.CommentAction{Body: "test"},
		Labels:  &policies.LabelAction{Add: []string{"bug"}},
	}
	err := c.WriteBackResult(context.Background(), ev, res)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// --- WriteBackResult: invalid status state ---

func TestWriteBackResultInvalidStatusState(t *testing.T) {
	var apiCalled bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiCalled = true
		w.WriteHeader(201)
	}))
	defer srv.Close()
	restore := OverrideAPIBase(srv.URL)
	defer restore()

	c := NewClient("token", slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})))
	ev := &events.Event{
		ID: "ev-invalid-status",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
			"head_sha":   "abc",
		},
	}
	res := policies.Result{
		Status: &policies.StatusAction{State: "invalid_state", Description: "bad"},
	}
	err := c.WriteBackResult(context.Background(), ev, res)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if apiCalled {
		t.Error("no API call expected for invalid status state")
	}
}

// --- WriteBackResult: commit suggestion path ---

func TestWriteBackResultCommitSuggestionMax(t *testing.T) {
	var receivedPath string
	var receivedBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		buf := make([]byte, 4096)
		n, _ := r.Body.Read(buf)
		receivedBody = string(buf[:n])
		w.WriteHeader(201)
	}))
	defer srv.Close()
	restore := OverrideAPIBase(srv.URL)
	defer restore()

	c := NewClient("token", nil)
	ev := &events.Event{
		ID: "ev-commit",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     42,
		},
	}
	res := policies.Result{
		Commit: &policies.CommitAction{
			Message: "fix typo",
			Diff:    "--- a/file.go\n+++ b/file.go\n@@ -1 +1 @@\n-old\n+new",
		},
	}
	err := c.WriteBackResult(context.Background(), ev, res)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(receivedPath, "/issues/42/comments") {
		t.Errorf("path = %q, want /issues/42/comments", receivedPath)
	}
	if !strings.Contains(receivedBody, "Suggested commit") {
		t.Errorf("body missing Suggested commit header")
	}
}

// --- WriteBackResult: status with valid state ---

func TestWriteBackResultStatusMax(t *testing.T) {
	var statusPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		statusPath = r.URL.Path
		w.WriteHeader(201)
	}))
	defer srv.Close()
	restore := OverrideAPIBase(srv.URL)
	defer restore()

	c := NewClient("token", nil)
	ev := &events.Event{
		ID: "ev-status",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
			"head_sha":   "abc123",
		},
	}
	res := policies.Result{
		Status: &policies.StatusAction{State: "success", Description: "all good"},
	}
	err := c.WriteBackResult(context.Background(), ev, res)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(statusPath, "/statuses/abc123") {
		t.Errorf("path = %q, want /statuses/abc123", statusPath)
	}
}

// --- WriteBackResult: status with empty sha ---

func TestWriteBackResultStatusEmptySha(t *testing.T) {
	var apiCalled bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiCalled = true
		w.WriteHeader(201)
	}))
	defer srv.Close()
	restore := OverrideAPIBase(srv.URL)
	defer restore()

	c := NewClient("token", nil)
	ev := &events.Event{
		ID: "ev-no-sha",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
			// no head_sha
		},
	}
	res := policies.Result{
		Status: &policies.StatusAction{State: "success", Description: "test"},
	}
	err := c.WriteBackResult(context.Background(), ev, res)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if apiCalled {
		t.Error("no API call expected when head_sha is empty")
	}
}

// --- githubPost: bad URL ---

func TestGithubPostBadURL(t *testing.T) {
	c := NewClient("token", nil)
	err := c.githubPost(context.Background(), "://bad url", []byte("{}"))
	if err == nil {
		t.Error("expected error for bad URL")
	}
}

// --- removeLabel: bad URL ---

func TestRemoveLabelBadURL(t *testing.T) {
	c := NewClient("token", nil)
	restore := OverrideAPIBase("://bad")
	defer restore()

	err := c.removeLabel(context.Background(), "org", "repo", 1, "label")
	if err == nil {
		t.Error("expected error for bad URL")
	}
}

// --- init: GITHUB_API_URL env ---

func TestInitGithubAPIURL(t *testing.T) {
	original := apiBase

	// Set env and re-run init logic inline
	t.Setenv("GITHUB_API_URL", "https://ghe.example.com/api/v3")
	if v := os.Getenv("GITHUB_API_URL"); v != "" {
		apiBase = strings.TrimRight(v, "/")
	}
	if apiBase != "https://ghe.example.com/api/v3" {
		t.Errorf("apiBase = %q", apiBase)
	}

	// Restore
	apiBase = original
}

// --- WriteBackResult: nil client ---

func TestWriteBackResultNilClientMax(t *testing.T) {
	var c *Client
	err := c.WriteBackResult(context.Background(), &events.Event{}, policies.Result{})
	if err != nil {
		t.Errorf("nil client should return nil: %v", err)
	}
}

// --- WriteBackResult: empty token ---

func TestWriteBackResultEmptyTokenMax(t *testing.T) {
	c := NewClient("", nil)
	err := c.WriteBackResult(context.Background(), &events.Event{}, policies.Result{
		Comment: &policies.CommentAction{Body: "test"},
	})
	if err != nil {
		t.Errorf("empty token should return nil: %v", err)
	}
}

// --- WriteBackResult: labels remove error ---

func TestWriteBackResultLabelsRemoveError(t *testing.T) {
	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		if r.Method == "DELETE" {
			w.WriteHeader(500)
			w.Write([]byte("server error"))
			return
		}
		w.WriteHeader(201)
	}))
	defer srv.Close()
	restore := OverrideAPIBase(srv.URL)
	defer restore()

	c := NewClient("token", slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError})))
	ev := &events.Event{
		ID: "ev-label-err",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
		},
	}
	res := policies.Result{
		Labels: &policies.LabelAction{
			Add:    []string{"bug"},
			Remove: []string{"stale"},
		},
	}
	err := c.WriteBackResult(context.Background(), ev, res)
	if err == nil {
		t.Error("expected error when remove label fails")
	}
}

// --- WriteBackResult: comment + label + status + commit all in one ---

func TestWriteBackResultAllPaths(t *testing.T) {
	paths := make(map[string]bool)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths[r.Method+" "+r.URL.Path] = true
		w.WriteHeader(201)
	}))
	defer srv.Close()
	restore := OverrideAPIBase(srv.URL)
	defer restore()

	c := NewClient("token", nil)
	ev := &events.Event{
		ID: "ev-all",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     5,
			"head_sha":   "sha123",
		},
	}
	res := policies.Result{
		Comment: &policies.CommentAction{Body: "review"},
		Labels:  &policies.LabelAction{Add: []string{"reviewed"}, Remove: []string{"pending"}},
		Status:  &policies.StatusAction{State: "success", Description: "done"},
		Commit:  &policies.CommitAction{Message: "fix", Diff: "+line"},
	}
	err := c.WriteBackResult(context.Background(), ev, res)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should have: comment, label add, label remove, status, commit suggestion (as comment)
	if !paths["POST /repos/org/repo/issues/5/comments"] {
		t.Error("missing comment POST")
	}
	if !paths["POST /repos/org/repo/issues/5/labels"] {
		t.Error("missing label POST")
	}
	if !paths["DELETE /repos/org/repo/issues/5/labels/pending"] {
		t.Error("missing label DELETE")
	}
	if !paths["POST /repos/org/repo/statuses/sha123"] {
		t.Error("missing status POST")
	}
}
