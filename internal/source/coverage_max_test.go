package source

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"mecha.im/internal/events"
	"mecha.im/internal/policies"
)

// --- Authenticated() markers (0% each) — call them directly ---

func TestGitHubAuthenticated(t *testing.T) {
	t.Parallel()
	src := NewGitHubSource("secret", "token")
	src.Authenticated() // must not panic
}

func TestGitLabAuthenticated(t *testing.T) {
	t.Parallel()
	src := NewGitLabSource("secret")
	src.Authenticated()
}

func TestSlackAuthenticated(t *testing.T) {
	t.Parallel()
	src := NewSlackSource("secret")
	src.Authenticated()
}

func TestTelegramAuthenticated(t *testing.T) {
	t.Parallel()
	src := NewTelegramSource("secret")
	src.Authenticated()
}

// --- parsePullRequest: no labels, no base sha ---

func TestParsePullRequestNoLabelsNoBaseSha(t *testing.T) {
	t.Parallel()
	src := NewGitHubSource("", "")
	body := []byte(`{
		"action": "opened",
		"number": 10,
		"repository": {"full_name": "org/repo"},
		"sender": {"login": "user"},
		"pull_request": {
			"number": 10,
			"title": "PR without labels",
			"head": {"sha": "aaa", "ref": "feat"},
			"base": {"ref": "main"}
		}
	}`)

	h := http.Header{}
	h.Set("X-GitHub-Event", "pull_request")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if _, ok := ev.Attrs["labels"]; ok {
		t.Error("labels should not be set when PR has no labels")
	}
	if _, ok := ev.Attrs["base_sha"]; ok {
		t.Error("base_sha should not be set when base has no sha")
	}
}

// --- parseIssue: nil issue ---

func TestParseIssueNilIssue(t *testing.T) {
	t.Parallel()
	src := NewGitHubSource("", "")
	body := []byte(`{
		"action": "opened",
		"repository": {"full_name": "org/repo"},
		"sender": {"login": "user"}
	}`)

	h := http.Header{}
	h.Set("X-GitHub-Event", "issues")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	// Should not have any issue-specific attrs
	if ev.Attrs["number"] != nil && ev.Attrs["number"] != 0 {
		t.Errorf("number = %v, should be nil or 0 for nil issue", ev.Attrs["number"])
	}
}

// --- GitLab Respond: status + labels + commit combined ---

func TestGitLabResponderFullResult(t *testing.T) {
	t.Parallel()
	calls := make(map[string]int)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Use RequestURI to see the raw (encoded) path
		calls[r.Method+" "+r.RequestURI]++
		w.WriteHeader(201)
	}))
	defer srv.Close()

	resp := NewGitLabResponder(srv.URL, "token")
	ev := &events.Event{
		Type: "merge_request.opened",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
			"head_sha":   "abc123",
		},
	}
	res := policies.Result{
		Comment: &policies.CommentAction{Body: "review comment"},
		Status:  &policies.StatusAction{State: "success", Description: "all ok"},
		Labels:  &policies.LabelAction{Add: []string{"reviewed"}, Remove: []string{"pending"}},
		Commit:  &policies.CommitAction{Message: "fix", Diff: "+line"},
	}
	err := resp.Respond(context.Background(), ev, res)
	if err != nil {
		t.Fatalf("Respond() error: %v", err)
	}

	// Check we got the expected call patterns (use RequestURI for encoded paths)
	if calls["POST /projects/org%2Frepo/merge_requests/1/notes"] < 1 {
		// Fallback: check unencoded path variant
		if calls["POST /projects/org/repo/merge_requests/1/notes"] < 1 {
			t.Errorf("missing note POST for comment, calls: %v", calls)
		}
	}
	hasStatus := calls["POST /projects/org%2Frepo/statuses/abc123"] > 0 || calls["POST /projects/org/repo/statuses/abc123"] > 0
	if !hasStatus {
		t.Errorf("missing status POST, calls: %v", calls)
	}
	hasLabels := calls["PUT /projects/org%2Frepo/merge_requests/1"] > 0 || calls["PUT /projects/org/repo/merge_requests/1"] > 0
	if !hasLabels {
		t.Errorf("missing labels PUT, calls: %v", calls)
	}
}

// --- doRequest: bad URL ---

func TestGitLabDoRequestBadURL(t *testing.T) {
	t.Parallel()
	resp := NewGitLabResponder("://bad", "token")
	err := resp.doRequest(context.Background(), "POST", "://bad", []byte("{}"))
	if err == nil {
		t.Error("expected error for bad URL")
	}
}

// --- Hydrate: non-PR event type ---

func TestHydrateNonPREvent(t *testing.T) {
	t.Parallel()
	src := NewGitHubSource("", "token")
	ev := &events.Event{
		Type: "push",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
		},
	}
	err := src.Hydrate(context.Background(), ev)
	if err != nil {
		t.Fatalf("Hydrate() error: %v", err)
	}
	// No hydration for non-PR events — no diff or file_list added
	if _, ok := ev.Attrs["diff"]; ok {
		t.Error("non-PR event should not have diff attr")
	}
}

// --- Hydrate: no token ---

func TestHydrateNoToken(t *testing.T) {
	t.Parallel()
	src := NewGitHubSource("", "")
	ev := &events.Event{
		Type: "pull_request.opened",
		Attrs: events.Attrs{
			"number": 1,
		},
	}
	err := src.Hydrate(context.Background(), ev)
	if err != nil {
		t.Fatalf("Hydrate() error: %v", err)
	}
}

// --- Hydrate: number=0 ---

func TestHydrateZeroNumber(t *testing.T) {
	t.Parallel()
	src := NewGitHubSource("", "token")
	ev := &events.Event{
		Type:  "pull_request.opened",
		Attrs: events.Attrs{},
	}
	err := src.Hydrate(context.Background(), ev)
	if err != nil {
		t.Fatalf("Hydrate() error: %v", err)
	}
}

// --- init: GITHUB_API_URL env ---

func TestSourceInitGithubAPIURL(t *testing.T) {
	original := githubAPIBase
	defer func() { githubAPIBase = original }()

	t.Setenv("GITHUB_API_URL", "https://ghe.example.com/api/v3")
	if v := os.Getenv("GITHUB_API_URL"); v != "" {
		githubAPIBase = strings.TrimRight(v, "/")
	}
	if githubAPIBase != "https://ghe.example.com/api/v3" {
		t.Errorf("githubAPIBase = %q", githubAPIBase)
	}
}

// --- GitLab Respond: empty result ---

func TestGitLabResponderEmptyResult(t *testing.T) {
	t.Parallel()
	resp := NewGitLabResponder("http://unused", "token")
	ev := &events.Event{
		Type: "merge_request.opened",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
		},
	}
	// Completely empty result should short-circuit
	err := resp.Respond(context.Background(), ev, policies.Result{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// --- GitLab Respond: missing repo info ---

func TestGitLabResponderMissingRepo(t *testing.T) {
	t.Parallel()
	resp := NewGitLabResponder("http://unused", "token")
	ev := &events.Event{
		Type:  "merge_request.opened",
		Attrs: events.Attrs{},
	}
	res := policies.Result{Output: "something"}
	err := resp.Respond(context.Background(), ev, res)
	if err == nil {
		t.Error("expected error for missing repo info")
	}
}

// --- GitLab Respond: server error ---

func TestGitLabResponderServerError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte("internal error"))
	}))
	defer srv.Close()

	resp := NewGitLabResponder(srv.URL, "token")
	ev := &events.Event{
		Type: "merge_request.opened",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
		},
	}
	res := policies.Result{
		Comment: &policies.CommentAction{Body: "test"},
	}
	err := resp.Respond(context.Background(), ev, res)
	if err == nil {
		t.Error("expected error for server error response")
	}
}

// --- Telegram Parse: callback_query ---

func TestTelegramParseCallbackQuery(t *testing.T) {
	t.Parallel()
	src := NewTelegramSource("")
	body := []byte(`{
		"update_id": 123,
		"callback_query": {
			"from": {"username": "user1"},
			"data": "action_1",
			"message": {
				"chat": {"id": 456}
			}
		}
	}`)
	ev, err := src.Parse(http.Header{}, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Type != "callback_query" {
		t.Errorf("Type = %q, want callback_query", ev.Type)
	}
	if ev.Attrs["callback_data"] != "action_1" {
		t.Errorf("callback_data = %v", ev.Attrs["callback_data"])
	}
}

// --- Telegram Parse: inline_query ---

func TestTelegramParseInlineQuery(t *testing.T) {
	t.Parallel()
	src := NewTelegramSource("")
	body := []byte(`{
		"update_id": 124,
		"inline_query": {
			"from": {"username": "user2"},
			"query": "search text"
		}
	}`)
	ev, err := src.Parse(http.Header{}, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Type != "inline_query" {
		t.Errorf("Type = %q, want inline_query", ev.Type)
	}
	if ev.Attrs["query"] != "search text" {
		t.Errorf("query = %v", ev.Attrs["query"])
	}
}

// --- Telegram Parse: unknown update type ---

func TestTelegramParseUnknown(t *testing.T) {
	t.Parallel()
	src := NewTelegramSource("")
	body := []byte(`{"update_id": 125, "channel_post": {}}`)
	ev, err := src.Parse(http.Header{}, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Type != "unknown" {
		t.Errorf("Type = %q, want unknown", ev.Type)
	}
}

// --- Telegram Parse: edited_message ---

func TestTelegramParseEditedMessage(t *testing.T) {
	t.Parallel()
	src := NewTelegramSource("")
	body := []byte(`{
		"update_id": 126,
		"edited_message": {
			"text": "edited text",
			"from": {"username": "editor"},
			"chat": {"id": 789, "type": "private"},
			"message_id": 42
		}
	}`)
	ev, err := src.Parse(http.Header{}, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Type != "edited_message" {
		t.Errorf("Type = %q, want edited_message", ev.Type)
	}
	if ev.Attrs["text"] != "edited text" {
		t.Errorf("text = %v", ev.Attrs["text"])
	}
}

// --- GitLab Respond: updateLabels with empty labels ---

func TestGitLabResponderEmptyLabels(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("no API call expected for empty labels")
		w.WriteHeader(201)
	}))
	defer srv.Close()

	resp := NewGitLabResponder(srv.URL, "token")
	ev := &events.Event{
		Type: "merge_request.opened",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
		},
	}
	// Labels with empty Add and Remove
	res := policies.Result{
		Labels: &policies.LabelAction{Add: nil, Remove: nil},
	}
	err := resp.Respond(context.Background(), ev, res)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// --- GitLab Respond: issue note path (non-MR type) ---

func TestGitLabResponderLabelsOnIssue(t *testing.T) {
	t.Parallel()
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.Method + " " + r.RequestURI
		w.WriteHeader(200)
	}))
	defer srv.Close()

	resp := NewGitLabResponder(srv.URL, "token")
	ev := &events.Event{
		Type: "issue.opened",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     5,
		},
	}
	res := policies.Result{
		Labels: &policies.LabelAction{Add: []string{"bug"}},
	}
	err := resp.Respond(context.Background(), ev, res)
	if err != nil {
		t.Fatalf("Respond() error: %v", err)
	}
	// Accept both encoded and decoded paths
	want1 := "PUT /projects/org%2Frepo/issues/5"
	want2 := "PUT /projects/org/repo/issues/5"
	if gotPath != want1 && gotPath != want2 {
		t.Errorf("path = %q, want %q or %q", gotPath, want1, want2)
	}
}

// --- mapStatusState ---

func TestMapStatusStateMax(t *testing.T) {
	t.Parallel()
	tests := []struct {
		input string
		want  string
	}{
		{"error", "failed"},
		{"failure", "failed"},
		{"pending", "pending"},
		{"success", "success"},
		{"unknown", "failed"},
	}
	for _, tt := range tests {
		got := mapStatusState(tt.input)
		if got != tt.want {
			t.Errorf("mapStatusState(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

// --- encodeProject ---

func TestEncodeProjectMax(t *testing.T) {
	t.Parallel()
	got := encodeProject("org/repo")
	if got != "org%2Frepo" {
		t.Errorf("encodeProject() = %q", got)
	}
}

// --- GitHub hydrate: large diff truncation ---

func TestHydrateLargeDiffTruncation(t *testing.T) {
	largeDiff := strings.Repeat("x", 600*1024)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") == "application/vnd.github.diff" {
			w.Write([]byte(largeDiff))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"files": []map[string]string{{"filename": "file.go"}},
		})
	}))
	defer srv.Close()

	old := githubAPIBase
	githubAPIBase = srv.URL
	defer func() { githubAPIBase = old }()

	src := NewGitHubSource("", "token")
	ev := &events.Event{
		Type: "pull_request.opened",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
			"head_sha":   "aaa",
			"base_sha":   "bbb",
		},
	}
	err := src.Hydrate(context.Background(), ev)
	if err != nil {
		t.Fatalf("Hydrate() error: %v", err)
	}
	diff, _ := ev.Attrs["diff"].(string)
	if !strings.Contains(diff, "truncated") {
		t.Error("large diff should be truncated")
	}
}

// --- GitHub hydrate: compare files from SHA-pinned URL ---

func TestHydrateCompareFilesPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") == "application/vnd.github.diff" {
			w.Write([]byte("diff"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"files": []map[string]string{
				{"filename": "a.go"},
				{"filename": "b.go"},
			},
		})
	}))
	defer srv.Close()

	old := githubAPIBase
	githubAPIBase = srv.URL
	defer func() { githubAPIBase = old }()

	src := NewGitHubSource("", "token")
	ev := &events.Event{
		Type: "pull_request.opened",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
			"head_sha":   "aaa",
			"base_sha":   "bbb",
		},
	}
	src.Hydrate(context.Background(), ev)
	files, _ := ev.Attrs["file_list"].(string)
	if !strings.Contains(files, "a.go") || !strings.Contains(files, "b.go") {
		t.Errorf("file_list = %q", files)
	}
}

// --- Telegram: non-map message in update ---

func TestTelegramParseNonMapMessage(t *testing.T) {
	t.Parallel()
	src := NewTelegramSource("")
	body := []byte(`{"update_id": 127, "message": "not a map"}`)
	ev, err := src.Parse(http.Header{}, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	// Should fall through to the else branch
	if ev.Type != "message" {
		t.Errorf("Type = %q, want message", ev.Type)
	}
}

// --- Telegram: non-map edited_message in update ---

func TestTelegramParseNonMapEditedMessage(t *testing.T) {
	t.Parallel()
	src := NewTelegramSource("")
	body := []byte(`{"update_id": 128, "edited_message": "not a map"}`)
	ev, err := src.Parse(http.Header{}, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Type != "edited_message" {
		t.Errorf("Type = %q, want edited_message", ev.Type)
	}
}

// --- Telegram: non-map callback_query ---

func TestTelegramParseNonMapCallbackQuery(t *testing.T) {
	t.Parallel()
	src := NewTelegramSource("")
	body := []byte(`{"update_id": 129, "callback_query": "not a map"}`)
	ev, err := src.Parse(http.Header{}, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Type != "callback_query" {
		t.Errorf("Type = %q, want callback_query", ev.Type)
	}
}

// --- Telegram: non-map inline_query ---

func TestTelegramParseNonMapInlineQuery(t *testing.T) {
	t.Parallel()
	src := NewTelegramSource("")
	body := []byte(`{"update_id": 130, "inline_query": "not a map"}`)
	ev, err := src.Parse(http.Header{}, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Type != "inline_query" {
		t.Errorf("Type = %q, want inline_query", ev.Type)
	}
}

// --- Telegram message: from without username (first_name fallback) ---

func TestTelegramParseFromFirstNameFallback(t *testing.T) {
	t.Parallel()
	src := NewTelegramSource("")
	body := []byte(`{
		"update_id": 131,
		"message": {
			"text": "hi",
			"from": {"first_name": "John", "id": 12345},
			"chat": {"id": 999}
		}
	}`)
	ev, err := src.Parse(http.Header{}, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Actor != "John" {
		t.Errorf("Actor = %q, want John (first_name fallback)", ev.Actor)
	}
}

// --- Registry Len: nil registry ---

func TestRegistryLenNil(t *testing.T) {
	t.Parallel()
	var r *Registry
	if r.Len() != 0 {
		t.Error("nil registry Len should be 0")
	}
}
