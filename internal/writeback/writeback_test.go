package writeback

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"mecha.im/internal/events"
	"mecha.im/internal/policies"
)

func testEvent() *events.Event {
	return &events.Event{
		ID:      "ev-1",
		Actor:   "alice",
		Subject: "testorg/testrepo",
		Attrs: events.Attrs{
			"repo_owner": "testorg",
			"repo_name":  "testrepo",
			"number":     42,
			"head_sha":   "abc123",
		},
	}
}

func TestWriteBackResultNilClient(t *testing.T) {
	var c *Client
	err := c.WriteBackResult(context.Background(), testEvent(), policies.Result{})
	if err != nil {
		t.Errorf("nil client should return nil, got %v", err)
	}
}

func TestWriteBackResultEmptyToken(t *testing.T) {
	c := NewClient("", slog.Default())
	err := c.WriteBackResult(context.Background(), testEvent(), policies.Result{})
	if err != nil {
		t.Errorf("empty token should return nil, got %v", err)
	}
}

func TestWriteBackResultComment(t *testing.T) {
	var called bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || !strings.Contains(r.URL.Path, "/comments") {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		called = true
		w.WriteHeader(201)
	}))
	defer srv.Close()
	old := apiBase
	apiBase = srv.URL
	defer func() { apiBase = old }()

	c := NewClient("test-token", slog.Default())
	err := c.WriteBackResult(context.Background(), testEvent(), policies.Result{
		Comment: &policies.CommentAction{Body: "hello"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !called {
		t.Error("comment endpoint was not called")
	}
}

func TestWriteBackResultStatus(t *testing.T) {
	var called bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/statuses/") {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		var body map[string]string
		json.NewDecoder(r.Body).Decode(&body)
		if body["state"] != "success" {
			t.Errorf("state = %q, want success", body["state"])
		}
		called = true
		w.WriteHeader(201)
	}))
	defer srv.Close()
	old := apiBase
	apiBase = srv.URL
	defer func() { apiBase = old }()

	c := NewClient("test-token", slog.Default())
	err := c.WriteBackResult(context.Background(), testEvent(), policies.Result{
		Status: &policies.StatusAction{State: "success", Description: "ok"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !called {
		t.Error("status endpoint was not called")
	}
}

func TestWriteBackResultInvalidStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("should not call API for invalid status")
		w.WriteHeader(201)
	}))
	defer srv.Close()
	old := apiBase
	apiBase = srv.URL
	defer func() { apiBase = old }()

	c := NewClient("test-token", slog.Default())
	err := c.WriteBackResult(context.Background(), testEvent(), policies.Result{
		Status: &policies.StatusAction{State: "invalid-state"},
	})
	if err != nil {
		t.Fatalf("invalid status should not error, got %v", err)
	}
}

func TestWriteBackResultLabels(t *testing.T) {
	var addCalled, removeCalled bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && strings.Contains(r.URL.Path, "/labels") {
			addCalled = true
		}
		if r.Method == "DELETE" && strings.Contains(r.URL.Path, "/labels/") {
			removeCalled = true
		}
		w.WriteHeader(200)
	}))
	defer srv.Close()
	old := apiBase
	apiBase = srv.URL
	defer func() { apiBase = old }()

	c := NewClient("test-token", slog.Default())
	err := c.WriteBackResult(context.Background(), testEvent(), policies.Result{
		Labels: &policies.LabelAction{Add: []string{"bug"}, Remove: []string{"stale"}},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !addCalled {
		t.Error("add label was not called")
	}
	if !removeCalled {
		t.Error("remove label was not called")
	}
}

func TestWriteBackResultErrorsJoined(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`{"message":"fail"}`))
	}))
	defer srv.Close()
	old := apiBase
	apiBase = srv.URL
	defer func() { apiBase = old }()

	c := NewClient("test-token", slog.Default())
	err := c.WriteBackResult(context.Background(), testEvent(), policies.Result{
		Comment: &policies.CommentAction{Body: "hello"},
		Status:  &policies.StatusAction{State: "success"},
	})
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "github 500") {
		t.Errorf("error should contain github 500: %v", err)
	}
}

func TestWriteBackResultCommitSuggestion(t *testing.T) {
	var called bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || !strings.Contains(r.URL.Path, "/comments") {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		var body map[string]string
		json.NewDecoder(r.Body).Decode(&body)
		if !strings.Contains(body["body"], "```diff") {
			t.Errorf("body should contain diff block, got %s", body["body"])
		}
		if !strings.Contains(body["body"], "Suggested commit") {
			t.Errorf("body should contain commit message header")
		}
		called = true
		w.WriteHeader(201)
	}))
	defer srv.Close()
	restore := OverrideAPIBase(srv.URL)
	defer restore()

	c := NewClient("test-token", slog.Default())
	err := c.WriteBackResult(context.Background(), testEvent(), policies.Result{
		Commit: &policies.CommitAction{Message: "fix typo", Diff: "--- a/f.go\n+++ b/f.go"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !called {
		t.Error("commit suggestion endpoint was not called")
	}
}

func TestWriteBackResultCommitNoDiff(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("should not call API when diff is empty")
	}))
	defer srv.Close()
	restore := OverrideAPIBase(srv.URL)
	defer restore()

	c := NewClient("test-token", slog.Default())
	err := c.WriteBackResult(context.Background(), testEvent(), policies.Result{
		Commit: &policies.CommitAction{Message: "fix", Diff: ""},
	})
	if err != nil {
		t.Fatalf("should succeed without API call: %v", err)
	}
}

func TestWriteBackResultNoNumber(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("should not call API when number is 0")
	}))
	defer srv.Close()
	old := apiBase
	apiBase = srv.URL
	defer func() { apiBase = old }()

	ev := testEvent()
	ev.Attrs["number"] = 0
	c := NewClient("test-token", slog.Default())
	err := c.WriteBackResult(context.Background(), ev, policies.Result{
		Comment: &policies.CommentAction{Body: "hello"},
		Labels:  &policies.LabelAction{Add: []string{"bug"}},
	})
	if err != nil {
		t.Fatalf("should succeed with no actions: %v", err)
	}
}

func TestResponderInterface(t *testing.T) {
	c := NewClient("token", slog.Default())
	if c.Name() != "github" {
		t.Errorf("Name() = %q, want github", c.Name())
	}
}
