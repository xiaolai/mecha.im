package source

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"mecha.im/internal/events"
)

func testHMAC(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func TestGitHubSourceName(t *testing.T) {
	t.Parallel()
	src := NewGitHubSource("secret", "token")
	if src.Name() != "github" {
		t.Errorf("Name() = %q, want github", src.Name())
	}
}

func TestGitHubSourceParsePR(t *testing.T) {
	t.Parallel()
	src := NewGitHubSource("test-secret", "")
	body := []byte(`{"action":"opened","repository":{"full_name":"org/repo"},"sender":{"login":"user"},"pull_request":{"number":1,"title":"PR","head":{"sha":"abc","ref":"feat"},"base":{"ref":"main"}}}`)

	h := http.Header{}
	h.Set("X-GitHub-Event", "pull_request")
	h.Set("X-GitHub-Delivery", "delivery-1")
	h.Set("X-Hub-Signature-256", testHMAC("test-secret", body))

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Type != "pull_request.opened" {
		t.Errorf("Type = %q, want pull_request.opened", ev.Type)
	}
	if ev.Subject != "org/repo" {
		t.Errorf("Subject = %q, want org/repo", ev.Subject)
	}
	if ev.Actor != "user" {
		t.Errorf("Actor = %q, want user", ev.Actor)
	}
	if ev.Attrs["repo_owner"] != "org" || ev.Attrs["repo_name"] != "repo" {
		t.Errorf("repo = %s/%s, want org/repo", ev.Attrs["repo_owner"], ev.Attrs["repo_name"])
	}
	if ev.Attrs["number"] != 1 {
		t.Errorf("number = %v, want 1", ev.Attrs["number"])
	}
	if ev.Attrs["head_sha"] != "abc" {
		t.Errorf("head_sha = %v, want abc", ev.Attrs["head_sha"])
	}
}

func TestGitHubSourceParseInvalidSignature(t *testing.T) {
	t.Parallel()
	src := NewGitHubSource("test-secret", "")
	body := []byte(`{}`)
	h := http.Header{}
	h.Set("X-GitHub-Event", "push")
	h.Set("X-Hub-Signature-256", "sha256=invalid")

	_, err := src.Parse(h, body)
	if err == nil {
		t.Error("expected error for invalid signature")
	}
}

func TestGitHubSourceParsePush(t *testing.T) {
	t.Parallel()
	src := NewGitHubSource("", "")
	body := []byte(`{"ref":"refs/heads/main","after":"deadbeef1234","compare":"https://example.com/compare","commits":[{"id":"deadbeef12345678","message":"fix bug"}],"repository":{"full_name":"org/repo"},"sender":{"login":"user"}}`)

	h := http.Header{}
	h.Set("X-GitHub-Event", "push")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Type != "push" {
		t.Errorf("Type = %q, want push", ev.Type)
	}
	if ev.Attrs["ref"] != "refs/heads/main" {
		t.Errorf("ref = %v", ev.Attrs["ref"])
	}
	if ev.Attrs["head_sha"] != "deadbeef1234" {
		t.Errorf("head_sha = %v", ev.Attrs["head_sha"])
	}
}

func TestGitHubSourceParseIssue(t *testing.T) {
	t.Parallel()
	src := NewGitHubSource("", "")
	body := []byte(`{"action":"opened","issue":{"number":5,"title":"Bug","body":"desc"},"repository":{"full_name":"org/repo"},"sender":{"login":"user"}}`)

	h := http.Header{}
	h.Set("X-GitHub-Event", "issues")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Type != "issues.opened" {
		t.Errorf("Type = %q", ev.Type)
	}
	if ev.Attrs["number"] != 5 {
		t.Errorf("number = %v, want 5", ev.Attrs["number"])
	}
}

func TestGitHubHydratePRWithBaseSHA(t *testing.T) {
	var diffURL string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") == "application/vnd.github.diff" {
			diffURL = r.URL.Path
			w.Write([]byte("--- a/file.go\n+++ b/file.go\n@@ -1 +1 @@\n-old\n+new"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`[{"filename":"file.go"},{"filename":"test.go"}]`))
	}))
	defer srv.Close()

	old := githubAPIBase
	githubAPIBase = srv.URL
	defer func() { githubAPIBase = old }()

	src := NewGitHubSource("", "test-token")
	ev := &events.Event{
		Type:    "pull_request.opened",
		Subject: "org/repo",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     42,
			"head_sha":   "abc123",
			"base_sha":   "def456",
		},
	}

	err := src.Hydrate(context.Background(), ev)
	if err != nil {
		t.Fatalf("Hydrate() error: %v", err)
	}
	// Verify SHA-pinned compare URL (not branch name)
	if !strings.Contains(diffURL, "def456...abc123") {
		t.Errorf("diff URL should use base_sha...head_sha, got %s", diffURL)
	}
	diff, _ := ev.Attrs["diff"].(string)
	if diff == "" {
		t.Error("expected diff to be populated")
	}
	files, _ := ev.Attrs["file_list"].(string)
	if files == "" {
		t.Error("expected file_list to be populated")
	}
}

func TestGitHubHydrateSHAPinnedFiles(t *testing.T) {
	// When base_sha and head_sha are available, file list should come from
	// the SHA-pinned compare endpoint (immutable), not the mutable PR files endpoint.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") == "application/vnd.github.diff" {
			w.Write([]byte("diff"))
			return
		}
		// Compare endpoint returns {files: [...]} JSON
		if strings.Contains(r.URL.Path, "/compare/") {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"files":[{"filename":"a.go"},{"filename":"b.go"},{"filename":"c.go"}]}`))
			return
		}
		// PR files endpoint should NOT be called when SHAs are available
		t.Error("PR files endpoint should not be called when SHAs are available")
		w.WriteHeader(500)
	}))
	defer srv.Close()

	old := githubAPIBase
	githubAPIBase = srv.URL
	defer func() { githubAPIBase = old }()

	src := NewGitHubSource("", "test-token")
	ev := &events.Event{
		Type:    "pull_request.opened",
		Subject: "org/repo",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
			"head_sha":   "abc",
			"base_sha":   "def",
		},
	}

	src.Hydrate(context.Background(), ev)
	files, _ := ev.Attrs["file_list"].(string)
	if !strings.Contains(files, "a.go") || !strings.Contains(files, "c.go") {
		t.Errorf("file_list should contain all files from compare endpoint, got: %s", files)
	}
}

func TestGitHubHydratePaginationFallback(t *testing.T) {
	// When SHAs are NOT available, file list falls back to the mutable
	// PR files endpoint with pagination.
	page := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") == "application/vnd.github.diff" {
			w.Write([]byte("diff"))
			return
		}
		page++
		w.Header().Set("Content-Type", "application/json")
		if page == 1 {
			next := "http://" + r.Host + "/repos/org/repo/pulls/1/files?per_page=100&page=2"
			w.Header().Set("Link", `<`+next+`>; rel="next"`)
			w.Write([]byte(`[{"filename":"a.go"},{"filename":"b.go"}]`))
		} else {
			w.Write([]byte(`[{"filename":"c.go"}]`))
		}
	}))
	defer srv.Close()

	old := githubAPIBase
	githubAPIBase = srv.URL
	defer func() { githubAPIBase = old }()

	src := NewGitHubSource("", "test-token")
	ev := &events.Event{
		Type:    "pull_request.opened",
		Subject: "org/repo",
		Attrs: events.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
			// No head_sha/base_sha — forces fallback to PR files endpoint
		},
	}

	src.Hydrate(context.Background(), ev)
	files, _ := ev.Attrs["file_list"].(string)
	if !strings.Contains(files, "a.go") || !strings.Contains(files, "c.go") {
		t.Errorf("file_list should contain files from both pages, got: %s", files)
	}
}

func TestGitHubHydrateSkipsWithoutToken(t *testing.T) {
	t.Parallel()
	src := NewGitHubSource("", "")
	ev := &events.Event{Type: "pull_request.opened", Attrs: events.Attrs{"number": 1}}
	err := src.Hydrate(context.Background(), ev)
	if err != nil {
		t.Fatalf("should succeed without token: %v", err)
	}
	if _, ok := ev.Attrs["diff"]; ok {
		t.Error("should not hydrate without token")
	}
}

func TestGitHubHydrateSkipsNonPR(t *testing.T) {
	t.Parallel()
	src := NewGitHubSource("", "token")
	ev := &events.Event{Type: "push", Attrs: events.Attrs{"number": 0}}
	err := src.Hydrate(context.Background(), ev)
	if err != nil {
		t.Fatalf("Hydrate() error: %v", err)
	}
}
