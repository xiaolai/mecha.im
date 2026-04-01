package source

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"mecha.im/internal/event"
	"mecha.im/internal/policy"
)

func TestGitLabResponder_Name(t *testing.T) {
	r := NewGitLabResponder("https://gitlab.com/api/v4", "test-token")
	if r.Name() != "gitlab" {
		t.Errorf("Name() = %q", r.Name())
	}
}

func TestGitLabResponder_PostComment(t *testing.T) {
	var gotPath, gotToken, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.RequestURI
		gotToken = r.Header.Get("PRIVATE-TOKEN")
		var payload map[string]string
		json.NewDecoder(r.Body).Decode(&payload)
		gotBody = payload["body"]
		w.WriteHeader(201)
	}))
	defer srv.Close()

	resp := NewGitLabResponder(srv.URL, "my-token")
	ev := &event.Event{
		Type: "merge_request.opened",
		Attrs: event.Attrs{
			"repo_owner": "acme",
			"repo_name":  "app",
			"number":     42,
		},
	}
	res := policy.Result{Output: "LGTM, looks good"}
	err := resp.Respond(context.Background(), ev, res)
	if err != nil {
		t.Fatal(err)
	}
	if gotToken != "my-token" {
		t.Errorf("token = %q", gotToken)
	}
	if gotPath != "/projects/acme%2Fapp/merge_requests/42/notes" {
		t.Errorf("path = %q", gotPath)
	}
	if gotBody != "LGTM, looks good" {
		t.Errorf("body = %q", gotBody)
	}
}

func TestGitLabResponder_EmptyResult(t *testing.T) {
	resp := NewGitLabResponder("https://gitlab.com/api/v4", "token")
	ev := &event.Event{Type: "merge_request.opened", Attrs: event.Attrs{}}
	err := resp.Respond(context.Background(), ev, policy.Result{})
	if err != nil {
		t.Errorf("empty result should not error: %v", err)
	}
}
