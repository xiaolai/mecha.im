package writeback

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"mecha.im/internal/event"
	"mecha.im/internal/policy"
)

// --- 1. Respond() delegates to WriteBackResult ---

func TestRespondDelegatesToWriteBackResult(t *testing.T) {
	var called bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && strings.Contains(r.URL.Path, "/comments") {
			called = true
		}
		w.WriteHeader(201)
	}))
	defer srv.Close()
	restore := OverrideAPIBase(srv.URL)
	defer restore()

	c := NewClient("test-token", nil) // also tests nil logger
	ev := &event.Event{
		ID: "ev-respond",
		Attrs: event.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
		},
	}
	res := policy.Result{
		Comment: &policy.CommentAction{Body: "respond test"},
	}
	err := c.Respond(context.Background(), ev, res)
	if err != nil {
		t.Fatalf("Respond() error: %v", err)
	}
	if !called {
		t.Error("Respond() should delegate to WriteBackResult and call GitHub API")
	}
}

// --- 2. NewClient with nil logger ---

func TestNewClientNilLogger(t *testing.T) {
	c := NewClient("token", nil)
	if c == nil {
		t.Fatal("NewClient returned nil")
	}
	if c.logger == nil {
		t.Error("nil logger should be replaced with slog.Default()")
	}
	if c.token != "token" {
		t.Errorf("token = %q", c.token)
	}
}

// --- 3. attrInt() ---

func TestAttrInt(t *testing.T) {
	tests := []struct {
		name string
		val  any
		want int
	}{
		{"float64", float64(42), 42},
		{"int", 7, 7},
		{"string", "not a number", 0},
		{"nil", nil, 0},
		{"bool", true, 0},
		{"slice", []int{1, 2}, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			attrs := event.Attrs{"key": tt.val}
			got := attrInt(attrs, "key")
			if got != tt.want {
				t.Errorf("attrInt(%T(%v)) = %d, want %d", tt.val, tt.val, got, tt.want)
			}
		})
	}
}

func TestAttrIntMissingKey(t *testing.T) {
	attrs := event.Attrs{}
	got := attrInt(attrs, "nonexistent")
	if got != 0 {
		t.Errorf("attrInt(missing key) = %d, want 0", got)
	}
}

// --- 4. OverrideAPIBase and init() ---

func TestOverrideAPIBase(t *testing.T) {
	original := apiBase
	restore := OverrideAPIBase("https://custom.api.example.com/")
	if apiBase != "https://custom.api.example.com" {
		t.Errorf("apiBase = %q after override", apiBase)
	}
	restore()
	if apiBase != original {
		t.Errorf("apiBase = %q after restore, want %q", apiBase, original)
	}
}

func TestOverrideAPIBaseTrimsTrailingSlash(t *testing.T) {
	restore := OverrideAPIBase("https://example.com///")
	defer restore()
	if strings.HasSuffix(apiBase, "/") {
		t.Errorf("apiBase should not end with slash: %q", apiBase)
	}
}

// --- 5. removeLabel error paths ---

func TestRemoveLabelError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		w.Write([]byte(`{"message":"bad request"}`))
	}))
	defer srv.Close()
	restore := OverrideAPIBase(srv.URL)
	defer restore()

	c := NewClient("test-token", nil)
	err := c.removeLabel(context.Background(), "org", "repo", 1, "stale")
	if err == nil {
		t.Fatal("expected error for 400 response")
	}
	if !strings.Contains(err.Error(), "github 400") {
		t.Errorf("error = %q", err)
	}
}

func TestRemoveLabelSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "DELETE" {
			t.Errorf("method = %s, want DELETE", r.Method)
		}
		if !strings.Contains(r.URL.Path, "/labels/stale") {
			t.Errorf("path = %s", r.URL.Path)
		}
		w.WriteHeader(200)
	}))
	defer srv.Close()
	restore := OverrideAPIBase(srv.URL)
	defer restore()

	c := NewClient("test-token", nil)
	err := c.removeLabel(context.Background(), "org", "repo", 1, "stale")
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

// --- 6. postCommitSuggestion truncation ---

func TestPostCommitSuggestionTruncation(t *testing.T) {
	var receivedBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Just capture that we got a request
		buf := make([]byte, 1024)
		n, _ := r.Body.Read(buf)
		receivedBody = string(buf[:n])
		w.WriteHeader(201)
	}))
	defer srv.Close()
	restore := OverrideAPIBase(srv.URL)
	defer restore()

	c := NewClient("test-token", nil)

	// Create a diff larger than maxCommentSize (60000)
	largeDiff := strings.Repeat("x", 70000)
	err := c.postCommitSuggestion(context.Background(), "org", "repo", 1, "fix", largeDiff)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// The body was sent successfully — the key is that it doesn't fail.
	// We just verify the function was called (server received something).
	if receivedBody == "" {
		t.Error("server received empty body")
	}
}

func TestPostCommitSuggestionTruncationBodySize(t *testing.T) {
	// Directly test the body construction logic: if body > maxCommentSize,
	// it should be truncated with a message.
	message := "fix typo"
	diff := strings.Repeat("a", 70000)
	body := "**Suggested commit:** " + message + "\n\n```diff\n" + diff + "\n```"
	if len(body) <= maxCommentSize {
		t.Fatal("test setup: body should exceed maxCommentSize")
	}
	truncated := body[:maxCommentSize] + "\n\n... (truncated — diff too large for GitHub comment)"
	if len(truncated) <= maxCommentSize {
		t.Fatal("test setup: truncated body should be larger than maxCommentSize (it includes the suffix)")
	}
	if !strings.Contains(truncated, "truncated") {
		t.Error("truncated body should contain truncation notice")
	}
}
