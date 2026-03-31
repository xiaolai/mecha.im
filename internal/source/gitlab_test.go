package source

import (
	"net/http"
	"testing"
)

func TestGitLabSourceName(t *testing.T) {
	src := NewGitLabSource("secret")
	if src.Name() != "gitlab" {
		t.Errorf("Name() = %q, want gitlab", src.Name())
	}
}

func TestGitLabSourceParseMergeRequest(t *testing.T) {
	src := NewGitLabSource("test-secret")
	body := []byte(`{
		"object_kind": "merge_request",
		"user": {"username": "dev"},
		"project": {"path_with_namespace": "group/project"},
		"object_attributes": {
			"iid": 10,
			"title": "Add feature",
			"description": "Details",
			"action": "open",
			"source_branch": "feature",
			"target_branch": "main",
			"last_commit": {"id": "abc123"}
		}
	}`)

	h := http.Header{}
	h.Set("X-Gitlab-Event", "Merge Request Hook")
	h.Set("X-Gitlab-Token", "test-secret")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Type != "merge_request.open" {
		t.Errorf("Type = %q, want merge_request.open", ev.Type)
	}
	if ev.Subject != "group/project" {
		t.Errorf("Subject = %q, want group/project", ev.Subject)
	}
	if ev.Attrs["repo_owner"] != "group" || ev.Attrs["repo_name"] != "project" {
		t.Errorf("repo = %s/%s", ev.Attrs["repo_owner"], ev.Attrs["repo_name"])
	}
	if ev.Attrs["number"] != 10 {
		t.Errorf("number = %v, want 10", ev.Attrs["number"])
	}
	if ev.Actor != "dev" {
		t.Errorf("Actor = %q", ev.Actor)
	}
	if ev.Attrs["head_sha"] != "abc123" {
		t.Errorf("head_sha = %v", ev.Attrs["head_sha"])
	}
}

func TestGitLabSourceParseInvalidToken(t *testing.T) {
	src := NewGitLabSource("correct-secret")
	h := http.Header{}
	h.Set("X-Gitlab-Event", "Push Hook")
	h.Set("X-Gitlab-Token", "wrong-secret")

	_, err := src.Parse(h, []byte(`{}`))
	if err == nil {
		t.Error("expected error for invalid token")
	}
}

func TestGitLabSourceParsePush(t *testing.T) {
	src := NewGitLabSource("")
	body := []byte(`{
		"ref": "refs/heads/main",
		"after": "deadbeef",
		"user": {"username": "dev"},
		"project": {"path_with_namespace": "org/repo"},
		"commits": [{"id": "deadbeef12345678", "message": "fix"}]
	}`)

	h := http.Header{}
	h.Set("X-Gitlab-Event", "Push Hook")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Type != "push" {
		t.Errorf("Type = %q, want push", ev.Type)
	}
	if ev.Attrs["head_sha"] != "deadbeef" {
		t.Errorf("head_sha = %v", ev.Attrs["head_sha"])
	}
}

func TestGitLabSourceParseNote(t *testing.T) {
	src := NewGitLabSource("")
	body := []byte(`{
		"object_kind": "note",
		"user": {"username": "reviewer"},
		"project": {"path_with_namespace": "org/repo"},
		"object_attributes": {"note": "LGTM"},
		"merge_request": {"iid": 5, "title": "Fix"}
	}`)

	h := http.Header{}
	h.Set("X-Gitlab-Event", "Note Hook")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Type != "note" {
		t.Errorf("Type = %q, want note", ev.Type)
	}
	if ev.Attrs["comment"] != "LGTM" {
		t.Errorf("comment = %v", ev.Attrs["comment"])
	}
	if ev.Attrs["number"] != 5 {
		t.Errorf("number = %v, want 5", ev.Attrs["number"])
	}
}

func TestGitLabSourceParseIssue(t *testing.T) {
	src := NewGitLabSource("")
	body := []byte(`{
		"object_kind": "issue",
		"user": {"username": "dev"},
		"project": {"path_with_namespace": "org/repo"},
		"object_attributes": {
			"iid": 3,
			"title": "Bug report",
			"description": "Something broke",
			"action": "open"
		}
	}`)

	h := http.Header{}
	h.Set("X-Gitlab-Event", "Issue Hook")

	ev, err := src.Parse(h, body)
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}
	if ev.Type != "issue.open" {
		t.Errorf("Type = %q, want issue.open", ev.Type)
	}
	if ev.Attrs["number"] != 3 {
		t.Errorf("number = %v, want 3", ev.Attrs["number"])
	}
}
