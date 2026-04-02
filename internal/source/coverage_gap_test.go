package source

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"mecha.im/internal/events"
	"mecha.im/internal/policies"
)

// --- 1. Authenticated() markers ---

func TestAuthenticatedMarkers(t *testing.T) {
	// Compile-time + runtime check that all four sources implement Authenticated.
	sources := []Authenticated{
		NewGitHubSource("", ""),
		NewGitLabSource(""),
		NewSlackSource(""),
		NewTelegramSource(""),
	}
	for _, s := range sources {
		s.Authenticated() // must not panic
	}
}

// --- 2. RegisterTrigger ---

type stubTrigger struct{ name string }

func (s *stubTrigger) Name() string { return s.name }
func (s *stubTrigger) Start(_ context.Context, _ func(*events.Event)) error {
	return nil
}

func TestRegisterTrigger(t *testing.T) {
	r := NewRegistry()
	tr := &stubTrigger{name: "my-cron"}
	r.RegisterTrigger(tr)

	got, ok := r.GetTrigger("my-cron")
	if !ok {
		t.Fatal("expected to find registered trigger")
	}
	if got.Name() != "my-cron" {
		t.Errorf("Name() = %q, want %q", got.Name(), "my-cron")
	}

	_, ok = r.GetTrigger("missing")
	if ok {
		t.Error("expected false for unregistered trigger")
	}
}

// --- 3. RegisterResponder ---

type stubResponder struct{ name string }

func (s *stubResponder) Name() string { return s.name }
func (s *stubResponder) Respond(_ context.Context, _ *events.Event, _ policies.Result) error {
	return nil
}

func TestRegisterResponder(t *testing.T) {
	r := NewRegistry()
	resp := &stubResponder{name: "test-responder"}
	r.RegisterResponder(resp)

	got, ok := r.GetResponder("test-responder")
	if !ok {
		t.Fatal("expected to find registered responder")
	}
	if got.Name() != "test-responder" {
		t.Errorf("Name() = %q, want %q", got.Name(), "test-responder")
	}
}

// --- 4. Triggers() returns a copy ---

func TestTriggersCopyIsolation(t *testing.T) {
	r := NewRegistry()
	tr := &stubTrigger{name: "real"}
	r.RegisterTrigger(tr)

	cp := r.Triggers()
	if len(cp) != 1 {
		t.Fatalf("expected 1 trigger, got %d", len(cp))
	}

	// Mutate the copy
	cp["hacked"] = &stubTrigger{name: "hacked"}
	delete(cp, "real")

	// Original must be unaffected
	got, ok := r.GetTrigger("real")
	if !ok || got.Name() != "real" {
		t.Error("modifying Triggers() copy must not affect registry")
	}
	_, ok = r.GetTrigger("hacked")
	if ok {
		t.Error("injected key must not appear in registry")
	}
}

// --- 5. parseIssueComment ---

func TestParseIssueComment(t *testing.T) {
	src := NewGitHubSource("", "")
	body := []byte(`{
		"action": "created",
		"issue": {"number": 42, "title": "Bug report"},
		"comment": {"body": "I can reproduce this"},
		"repository": {"full_name": "org/repo"},
		"sender": {"login": "commenter"}
	}`)

	h := http.Header{}
	h.Set("X-GitHub-Event", "issue_comment")
	h.Set("X-GitHub-Delivery", "delivery-ic")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Type != "issue_comment.created" {
		t.Errorf("Type = %q, want issue_comment.created", ev.Type)
	}
	if ev.Attrs["number"] != 42 {
		t.Errorf("number = %v, want 42", ev.Attrs["number"])
	}
	if ev.Attrs["title"] != "Bug report" {
		t.Errorf("title = %v, want Bug report", ev.Attrs["title"])
	}
	if ev.Attrs["comment"] != "I can reproduce this" {
		t.Errorf("comment = %v", ev.Attrs["comment"])
	}
}

// --- 6. commentBody ---

func TestCommentBody(t *testing.T) {
	tests := []struct {
		name string
		res  policies.Result
		want string
	}{
		{
			name: "prefers Comment.Body",
			res: policies.Result{
				Output:  "fallback output",
				Comment: &policies.CommentAction{Body: "explicit comment"},
			},
			want: "explicit comment",
		},
		{
			name: "falls back to Output when Comment is nil",
			res:  policies.Result{Output: "output text"},
			want: "output text",
		},
		{
			name: "falls back to Output when Comment.Body is empty",
			res: policies.Result{
				Output:  "output text",
				Comment: &policies.CommentAction{Body: ""},
			},
			want: "output text",
		},
		{
			name: "both empty returns empty",
			res:  policies.Result{},
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := commentBody(tt.res)
			if got != tt.want {
				t.Errorf("commentBody() = %q, want %q", got, tt.want)
			}
		})
	}
}

// --- 7. abs ---

func TestAbs(t *testing.T) {
	tests := []struct {
		input int64
		want  int64
	}{
		{5, 5},
		{-5, 5},
		{0, 0},
		{-1, 1},
		{1, 1},
	}
	for _, tt := range tests {
		got := abs(tt.input)
		if got != tt.want {
			t.Errorf("abs(%d) = %d, want %d", tt.input, got, tt.want)
		}
	}
}

// --- 8. parsePullRequest — labels, nested number, base sha ---

func TestParsePullRequestLabels(t *testing.T) {
	src := NewGitHubSource("", "")
	body := []byte(`{
		"action": "opened",
		"repository": {"full_name": "org/repo"},
		"sender": {"login": "user"},
		"pull_request": {
			"number": 99,
			"title": "PR with labels",
			"head": {"sha": "aaa", "ref": "feat"},
			"base": {"ref": "main", "sha": "bbb"},
			"labels": [
				{"name": "bug"},
				{"name": "priority:high"}
			]
		}
	}`)

	h := http.Header{}
	h.Set("X-GitHub-Event", "pull_request")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	labels, _ := ev.Attrs["labels"].(string)
	if !strings.Contains(labels, "bug") || !strings.Contains(labels, "priority:high") {
		t.Errorf("labels = %q, want 'bug, priority:high'", labels)
	}
	if ev.Attrs["base_sha"] != "bbb" {
		t.Errorf("base_sha = %v, want bbb", ev.Attrs["base_sha"])
	}
}

func TestParsePullRequestNestedNumber(t *testing.T) {
	// When top-level number is 0 or absent, falls back to PR-level number
	src := NewGitHubSource("", "")
	body := []byte(`{
		"action": "opened",
		"repository": {"full_name": "org/repo"},
		"sender": {"login": "user"},
		"pull_request": {
			"number": 77,
			"title": "Nested number",
			"head": {"sha": "abc", "ref": "feat"},
			"base": {"ref": "main"}
		}
	}`)

	h := http.Header{}
	h.Set("X-GitHub-Event", "pull_request")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Attrs["number"] != 77 {
		t.Errorf("number = %v, want 77", ev.Attrs["number"])
	}
}

// --- 9. normalizeGitLabEvent ---

func TestNormalizeGitLabEvent(t *testing.T) {
	tests := []struct {
		name    string
		glEvent string
		payload map[string]any
		want    string
	}{
		{
			name:    "merge request with action",
			glEvent: "Merge Request Hook",
			payload: map[string]any{"object_attributes": map[string]any{"action": "open"}},
			want:    "merge_request.open",
		},
		{
			name:    "merge request without action",
			glEvent: "Merge Request Hook",
			payload: map[string]any{},
			want:    "merge_request",
		},
		{
			name:    "push hook",
			glEvent: "Push Hook",
			payload: map[string]any{},
			want:    "push",
		},
		{
			name:    "tag push hook",
			glEvent: "Tag Push Hook",
			payload: map[string]any{},
			want:    "tag_push",
		},
		{
			name:    "note hook",
			glEvent: "Note Hook",
			payload: map[string]any{},
			want:    "note",
		},
		{
			name:    "issue hook with action",
			glEvent: "Issue Hook",
			payload: map[string]any{"object_attributes": map[string]any{"action": "close"}},
			want:    "issue.close",
		},
		{
			name:    "issue hook without action",
			glEvent: "Issue Hook",
			payload: map[string]any{},
			want:    "issue",
		},
		{
			name:    "unknown hook",
			glEvent: "Pipeline Hook",
			payload: map[string]any{},
			want:    "pipeline_hook",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeGitLabEvent(tt.glEvent, tt.payload)
			if got != tt.want {
				t.Errorf("normalizeGitLabEvent(%q) = %q, want %q", tt.glEvent, got, tt.want)
			}
		})
	}
}

// --- 10. parseGitLabNote — note on issue (not MR) ---

func TestParseGitLabNoteOnIssue(t *testing.T) {
	src := NewGitLabSource("")
	body := []byte(`{
		"object_kind": "note",
		"user": {"username": "reviewer"},
		"project": {"path_with_namespace": "org/repo"},
		"object_attributes": {"note": "Confirmed bug"},
		"issue": {"iid": 15, "title": "Bug"}
	}`)

	h := http.Header{}
	h.Set("X-Gitlab-Event", "Note Hook")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Attrs["comment"] != "Confirmed bug" {
		t.Errorf("comment = %v", ev.Attrs["comment"])
	}
	if ev.Attrs["number"] != 15 {
		t.Errorf("number = %v, want 15", ev.Attrs["number"])
	}
	if ev.Attrs["title"] != "Bug" {
		t.Errorf("title = %v, want Bug", ev.Attrs["title"])
	}
}

// --- 11. parseGitLabIssue — nil object_attributes ---

func TestParseGitLabIssueNilAttrs(t *testing.T) {
	src := NewGitLabSource("")
	// Issue Hook with no object_attributes
	body := []byte(`{
		"user": {"username": "dev"},
		"project": {"path_with_namespace": "org/repo"}
	}`)

	h := http.Header{}
	h.Set("X-Gitlab-Event", "Issue Hook")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	// parseGitLabIssue should return early without crashing
	if ev.Attrs["number"] != nil {
		t.Errorf("expected nil number for nil object_attributes, got %v", ev.Attrs["number"])
	}
}

// --- 12. githubGet error paths ---

func TestGitHubGetNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		w.Write([]byte("not found"))
	}))
	defer srv.Close()

	old := githubAPIBase
	githubAPIBase = srv.URL
	defer func() { githubAPIBase = old }()

	src := NewGitHubSource("", "test-token")
	ev := &events.Event{
		Type: "pull_request.opened",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
			// No base_sha to force the non-compare path
		},
	}

	err := src.Hydrate(context.Background(), ev)
	if err != nil {
		t.Fatalf("Hydrate() should not return error (errors stored in attrs): %v", err)
	}
	// Diff error should be stored in attrs
	diffErr, _ := ev.Attrs["diff_error"].(string)
	if diffErr == "" {
		t.Error("expected diff_error attr when API returns non-200")
	}
}

func TestGitHubGetInvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") == "application/vnd.github.diff" {
			w.Write([]byte("valid diff"))
			return
		}
		// Return invalid JSON for file list
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("not valid json"))
	}))
	defer srv.Close()

	old := githubAPIBase
	githubAPIBase = srv.URL
	defer func() { githubAPIBase = old }()

	src := NewGitHubSource("", "test-token")
	ev := &events.Event{
		Type: "pull_request.opened",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
			"head_sha":   "abc",
			"base_sha":   "def",
		},
	}

	err := src.Hydrate(context.Background(), ev)
	if err != nil {
		t.Fatalf("Hydrate() error: %v", err)
	}
	// Invalid JSON means extractCompareFiles returns nil, falls back to PR files
	// which also returns invalid JSON, so file_list should be empty
	files, _ := ev.Attrs["file_list"].(string)
	if files != "" {
		t.Errorf("expected empty file_list for invalid JSON, got %q", files)
	}
}

// --- 13. githubGetPaginated — pagination with Link header ---

func TestGitHubGetPaginatedWithLink(t *testing.T) {
	page := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") == "application/vnd.github.diff" {
			w.Write([]byte("diff content"))
			return
		}
		page++
		w.Header().Set("Content-Type", "application/json")
		if page == 1 {
			// First page has Link header
			next := "http://" + r.Host + "/repos/org/repo/pulls/1/files?page=2"
			w.Header().Set("Link", `<`+next+`>; rel="next", <http://example.com>; rel="last"`)
			w.Write([]byte(`[{"filename":"first.go"}]`))
		} else if page == 2 {
			// Second page, no Link header
			w.Write([]byte(`[{"filename":"second.go"}]`))
		}
	}))
	defer srv.Close()

	old := githubAPIBase
	githubAPIBase = srv.URL
	defer func() { githubAPIBase = old }()

	src := NewGitHubSource("", "test-token")
	ev := &events.Event{
		Type: "pull_request.opened",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
			// No SHAs — forces paginated fallback
		},
	}

	src.Hydrate(context.Background(), ev)
	files, _ := ev.Attrs["file_list"].(string)
	if !strings.Contains(files, "first.go") || !strings.Contains(files, "second.go") {
		t.Errorf("file_list should contain both pages, got: %q", files)
	}
}

// --- 14. generic.Parse — boolean values ---

func TestGenericSourceParseBoolValues(t *testing.T) {
	src := NewGenericSource("test-bool", "X-Event-Type")
	body := []byte(`{"active": true, "deleted": false, "name": "item", "count": 5.0}`)

	h := http.Header{}
	h.Set("X-Event-Type", "item.updated")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Attrs["active"] != true {
		t.Errorf("active = %v (type %T), want true", ev.Attrs["active"], ev.Attrs["active"])
	}
	if ev.Attrs["deleted"] != false {
		t.Errorf("deleted = %v (type %T), want false", ev.Attrs["deleted"], ev.Attrs["deleted"])
	}
	if ev.Attrs["name"] != "item" {
		t.Errorf("name = %v", ev.Attrs["name"])
	}
	if ev.Attrs["count"] != 5.0 {
		t.Errorf("count = %v", ev.Attrs["count"])
	}
}

// --- Additional: GitLab deliveryID fallback paths ---

func TestGitLabDeliveryIDFallback(t *testing.T) {
	src := NewGitLabSource("")

	// No UUID, but has instance + request ID
	body := []byte(`{"user_username": "dev", "project": {"path_with_namespace": "org/repo"}}`)
	h := http.Header{}
	h.Set("X-Gitlab-Event", "Push Hook")
	h.Set("X-Gitlab-Instance", "https://gitlab.example.com")
	h.Set("X-Request-Id", "req-123")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.DeliveryID != "https://gitlab.example.com/req-123" {
		t.Errorf("DeliveryID = %q", ev.DeliveryID)
	}
}

func TestGitLabDeliveryIDEmpty(t *testing.T) {
	src := NewGitLabSource("")

	body := []byte(`{"user_username": "dev", "project": {"path_with_namespace": "org/repo"}}`)
	h := http.Header{}
	h.Set("X-Gitlab-Event", "Push Hook")
	// No UUID, no instance, no request ID

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.DeliveryID != "" {
		t.Errorf("DeliveryID = %q, want empty", ev.DeliveryID)
	}
}

// --- Additional: GitLab actor extraction via user_username ---

func TestGitLabActorFromUserUsername(t *testing.T) {
	src := NewGitLabSource("")

	body := []byte(`{
		"user_username": "topleveldude",
		"user": {"username": "nested"},
		"project": {"path_with_namespace": "org/repo"}
	}`)
	h := http.Header{}
	h.Set("X-Gitlab-Event", "Push Hook")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	// user_username takes priority over user.username
	if ev.Actor != "topleveldude" {
		t.Errorf("Actor = %q, want topleveldude", ev.Actor)
	}
}

// --- Additional: GitHub missing event header ---

func TestGitHubMissingEventHeader(t *testing.T) {
	src := NewGitHubSource("", "")
	_, err := src.Parse(http.Header{}, []byte(`{}`))
	if err == nil {
		t.Error("expected error for missing X-GitHub-Event header")
	}
}

// --- Additional: GitHub invalid JSON body ---

func TestGitHubInvalidJSON(t *testing.T) {
	src := NewGitHubSource("", "")
	h := http.Header{}
	h.Set("X-GitHub-Event", "push")
	_, err := src.Parse(h, []byte("not json"))
	if err == nil {
		t.Error("expected error for invalid JSON body")
	}
}

// --- Additional: GitLab missing event header ---

func TestGitLabMissingEventHeader(t *testing.T) {
	src := NewGitLabSource("")
	_, err := src.Parse(http.Header{}, []byte(`{}`))
	if err == nil {
		t.Error("expected error for missing X-Gitlab-Event header")
	}
}

// --- Additional: GitLab invalid JSON body ---

func TestGitLabInvalidJSON(t *testing.T) {
	src := NewGitLabSource("")
	h := http.Header{}
	h.Set("X-Gitlab-Event", "Push Hook")
	_, err := src.Parse(h, []byte("not json"))
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

// --- Additional: Generic invalid JSON ---

func TestGenericSourceInvalidJSON(t *testing.T) {
	src := NewGenericSource("test", "X-Event-Type")
	h := http.Header{}
	h.Set("X-Event-Type", "test.event")
	_, err := src.Parse(h, []byte("not json"))
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

// --- Additional: parseIssueComment with missing fields ---

func TestParseIssueCommentMissingFields(t *testing.T) {
	src := NewGitHubSource("", "")
	// issue_comment with no issue or comment
	body := []byte(`{
		"action": "deleted",
		"repository": {"full_name": "org/repo"},
		"sender": {"login": "user"}
	}`)

	h := http.Header{}
	h.Set("X-GitHub-Event", "issue_comment")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Type != "issue_comment.deleted" {
		t.Errorf("Type = %q", ev.Type)
	}
	// Should not have number or comment attrs set
	if ev.Attrs["number"] != nil && ev.Attrs["number"] != 0 {
		t.Errorf("expected no number, got %v", ev.Attrs["number"])
	}
}

// --- Additional: GitLab Note Hook with no merge_request or issue ---

func TestParseGitLabNoteNoTarget(t *testing.T) {
	src := NewGitLabSource("")
	body := []byte(`{
		"object_kind": "note",
		"user": {"username": "reviewer"},
		"project": {"path_with_namespace": "org/repo"},
		"object_attributes": {"note": "A note"}
	}`)

	h := http.Header{}
	h.Set("X-Gitlab-Event", "Note Hook")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Attrs["comment"] != "A note" {
		t.Errorf("comment = %v", ev.Attrs["comment"])
	}
	// No merge_request or issue -> number should not be set
	if ev.Attrs["number"] != nil && ev.Attrs["number"] != 0 {
		t.Errorf("number should not be set, got %v", ev.Attrs["number"])
	}
}

// --- Additional: GitLab Respond issue note path ---

func TestGitLabResponderIssueNotePath(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.RequestURI
		w.WriteHeader(201)
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
		Comment: &policies.CommentAction{Body: "Comment body"},
	}
	err := resp.Respond(context.Background(), ev, res)
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/projects/org%2Frepo/issues/5/notes" {
		t.Errorf("path = %q, want /projects/org%%2Frepo/issues/5/notes", gotPath)
	}
}

// --- Additional: GitHub HMAC signature with missing prefix ---

func TestValidateSignatureMissingPrefix(t *testing.T) {
	// Signature without sha256= prefix should fail
	result := validateSignature("secret", []byte("body"), "invalid-no-prefix")
	if result {
		t.Error("expected false for signature without sha256= prefix")
	}
}

// --- Additional: intVal helper ---

func TestIntVal(t *testing.T) {
	tests := []struct {
		input any
		want  int
	}{
		{float64(42), 42},
		{42, 42},
		{"string", 0},
		{nil, 0},
		{true, 0},
	}
	for _, tt := range tests {
		got := intVal(tt.input)
		if got != tt.want {
			t.Errorf("intVal(%v) = %d, want %d", tt.input, got, tt.want)
		}
	}
}

// --- Additional: GitHub hydrate non-200 paginated response ---

func TestGitHubGetPaginatedNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") == "application/vnd.github.diff" {
			w.Write([]byte("diff"))
			return
		}
		if strings.Contains(r.Header.Get("Accept"), "json") {
			// Compare endpoint returns valid JSON
			if strings.Contains(r.URL.Path, "/compare/") {
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte(`{"files":[]}`))
				return
			}
			// File list returns error
			w.WriteHeader(500)
			w.Write([]byte("server error"))
			return
		}
		w.WriteHeader(200)
	}))
	defer srv.Close()

	old := githubAPIBase
	githubAPIBase = srv.URL
	defer func() { githubAPIBase = old }()

	src := NewGitHubSource("", "test-token")
	ev := &events.Event{
		Type: "pull_request.opened",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
			// No SHAs, forces paginated fallback with error
		},
	}

	err := src.Hydrate(context.Background(), ev)
	if err != nil {
		t.Fatalf("Hydrate should not error: %v", err)
	}
}

// --- Additional: Telegram parse with no update_id ---

func TestTelegramParseNoUpdateID(t *testing.T) {
	src := NewTelegramSource("")
	body := []byte(`{"message": {"text": "hi", "from": {"username": "u"}, "chat": {"id": 1}}}`)
	ev, err := src.Parse(http.Header{}, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Attrs["update_id"] != "" {
		t.Errorf("update_id = %v, want empty string", ev.Attrs["update_id"])
	}
}

// --- Additional: parseNextLink ---

func TestParseNextLink(t *testing.T) {
	tests := []struct {
		name string
		link string
		want string
	}{
		{
			name: "has next",
			link: `<https://api.github.com/repos/org/repo/pulls/1/files?page=2>; rel="next", <https://api.github.com/repos/org/repo/pulls/1/files?page=5>; rel="last"`,
			want: "https://api.github.com/repos/org/repo/pulls/1/files?page=2",
		},
		{
			name: "no next",
			link: `<https://api.github.com/repos/org/repo/pulls/1/files?page=1>; rel="last"`,
			want: "",
		},
		{
			name: "empty",
			link: "",
			want: "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseNextLink(tt.link)
			if got != tt.want {
				t.Errorf("parseNextLink() = %q, want %q", got, tt.want)
			}
		})
	}
}

// --- Additional: extractFileList with invalid JSON ---

func TestExtractFileListInvalidJSON(t *testing.T) {
	result := extractFileList("not json")
	if result != nil {
		t.Errorf("expected nil for invalid JSON, got %v", result)
	}
}

// --- Additional: extractCompareFiles with invalid JSON ---

func TestExtractCompareFilesInvalidJSON(t *testing.T) {
	result := extractCompareFiles("not json")
	if result != nil {
		t.Errorf("expected nil for invalid JSON, got %v", result)
	}
}

// --- Additional: GitLab Respond with Comment.Body set ---

func TestGitLabResponderCommentBody(t *testing.T) {
	var gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]string
		json.NewDecoder(r.Body).Decode(&payload)
		gotBody = payload["body"]
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
	res := policies.Result{
		Output:  "fallback",
		Comment: &policies.CommentAction{Body: "explicit comment body"},
	}
	err := resp.Respond(context.Background(), ev, res)
	if err != nil {
		t.Fatal(err)
	}
	if gotBody != "explicit comment body" {
		t.Errorf("body = %q, want %q", gotBody, "explicit comment body")
	}
}
