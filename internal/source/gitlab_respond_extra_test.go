package source

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"mecha.im/internal/event"
	"mecha.im/internal/policy"
)

func TestGitLabResponder_Labels(t *testing.T) {
	tests := []struct {
		name         string
		evType       string
		labels       *policy.LabelAction
		wantMethod   string
		wantPath     string
		wantAdd      string
		wantRemove   string
	}{
		{
			name:       "add labels to MR",
			evType:     "merge_request.opened",
			labels:     &policy.LabelAction{Add: []string{"security", "review"}, Remove: nil},
			wantMethod: "PUT",
			wantPath:   "/projects/acme%2Frepo/merge_requests/10",
			wantAdd:    "security,review",
		},
		{
			name:       "remove labels from MR",
			evType:     "merge_request.opened",
			labels:     &policy.LabelAction{Add: nil, Remove: []string{"needs-review"}},
			wantMethod: "PUT",
			wantPath:   "/projects/acme%2Frepo/merge_requests/10",
			wantRemove: "needs-review",
		},
		{
			name:       "add and remove labels on issue",
			evType:     "issue.opened",
			labels:     &policy.LabelAction{Add: []string{"bug"}, Remove: []string{"triage"}},
			wantMethod: "PUT",
			wantPath:   "/projects/acme%2Frepo/issues/10",
			wantAdd:    "bug",
			wantRemove: "triage",
		},
		{
			name:       "note event uses MR endpoint",
			evType:     "note.merge_request",
			labels:     &policy.LabelAction{Add: []string{"reviewed"}},
			wantMethod: "PUT",
			wantPath:   "/projects/acme%2Frepo/merge_requests/10",
			wantAdd:    "reviewed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotMethod, gotPath string
			var gotPayload map[string]string

			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotMethod = r.Method
				gotPath = r.RequestURI
				body, _ := io.ReadAll(r.Body)
				json.Unmarshal(body, &gotPayload)
				w.WriteHeader(200)
			}))
			defer srv.Close()

			resp := NewGitLabResponder(srv.URL, "token")
			ev := &event.Event{
				Type: tt.evType,
				Attrs: event.Attrs{
					"repo_owner": "acme",
					"repo_name":  "repo",
					"number":     10,
				},
			}
			res := policy.Result{Labels: tt.labels}
			err := resp.Respond(context.Background(), ev, res)
			if err != nil {
				t.Fatalf("Respond() error = %v", err)
			}
			if gotMethod != tt.wantMethod {
				t.Errorf("method = %q, want %q", gotMethod, tt.wantMethod)
			}
			if gotPath != tt.wantPath {
				t.Errorf("path = %q, want %q", gotPath, tt.wantPath)
			}
			if tt.wantAdd != "" && gotPayload["add_labels"] != tt.wantAdd {
				t.Errorf("add_labels = %q, want %q", gotPayload["add_labels"], tt.wantAdd)
			}
			if tt.wantRemove != "" && gotPayload["remove_labels"] != tt.wantRemove {
				t.Errorf("remove_labels = %q, want %q", gotPayload["remove_labels"], tt.wantRemove)
			}
		})
	}
}

func TestGitLabResponder_Status(t *testing.T) {
	tests := []struct {
		name      string
		state     string
		desc      string
		wantState string
	}{
		{"success", "success", "all good", "success"},
		{"failure", "failure", "tests failed", "failed"},
		{"error", "error", "build error", "failed"},
		{"pending", "pending", "in progress", "pending"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotPath string
			var gotPayload map[string]string

			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.RequestURI
				body, _ := io.ReadAll(r.Body)
				json.Unmarshal(body, &gotPayload)
				w.WriteHeader(201)
			}))
			defer srv.Close()

			resp := NewGitLabResponder(srv.URL, "token")
			ev := &event.Event{
				Type: "merge_request.opened",
				Attrs: event.Attrs{
					"repo_owner": "org",
					"repo_name":  "project",
					"number":     5,
					"head_sha":   "abc123def",
				},
			}
			res := policy.Result{
				Status: &policy.StatusAction{
					State:       tt.state,
					Description: tt.desc,
				},
			}

			err := resp.Respond(context.Background(), ev, res)
			if err != nil {
				t.Fatalf("Respond() error = %v", err)
			}
			wantPath := "/projects/org%2Fproject/statuses/abc123def"
			if gotPath != wantPath {
				t.Errorf("path = %q, want %q", gotPath, wantPath)
			}
			if gotPayload["state"] != tt.wantState {
				t.Errorf("state = %q, want %q", gotPayload["state"], tt.wantState)
			}
			if gotPayload["description"] != tt.desc {
				t.Errorf("description = %q, want %q", gotPayload["description"], tt.desc)
			}
			if gotPayload["name"] != "mecha" {
				t.Errorf("name = %q, want %q", gotPayload["name"], "mecha")
			}
		})
	}
}

func TestGitLabResponder_CommitSuggestion(t *testing.T) {
	var gotPath string
	var gotPayload map[string]string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.RequestURI
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &gotPayload)
		w.WriteHeader(201)
	}))
	defer srv.Close()

	resp := NewGitLabResponder(srv.URL, "token")
	ev := &event.Event{
		Type: "merge_request.opened",
		Attrs: event.Attrs{
			"repo_owner": "myorg",
			"repo_name":  "myrepo",
			"number":     7,
		},
	}
	res := policy.Result{
		Commit: &policy.CommitAction{
			Message: "fix: update config",
			Diff:    "--- a/file.go\n+++ b/file.go\n@@ -1 +1 @@\n-old\n+new",
		},
	}

	err := resp.Respond(context.Background(), ev, res)
	if err != nil {
		t.Fatalf("Respond() error = %v", err)
	}

	wantPath := "/projects/myorg%2Fmyrepo/merge_requests/7/notes"
	if gotPath != wantPath {
		t.Errorf("path = %q, want %q", gotPath, wantPath)
	}
	if !strings.Contains(gotPayload["body"], "fix: update config") {
		t.Errorf("body should contain commit message, got: %q", gotPayload["body"])
	}
	if !strings.Contains(gotPayload["body"], "```diff") {
		t.Errorf("body should contain diff block, got: %q", gotPayload["body"])
	}
	if !strings.Contains(gotPayload["body"], "-old") {
		t.Errorf("body should contain diff content, got: %q", gotPayload["body"])
	}
}

func TestMapStatusState(t *testing.T) {
	tests := []struct {
		ghState string
		want    string
	}{
		{"success", "success"},
		{"failure", "failed"},
		{"error", "failed"},
		{"pending", "pending"},
		{"unknown", "failed"},
		{"", "failed"},
	}
	for _, tt := range tests {
		t.Run(tt.ghState, func(t *testing.T) {
			got := mapStatusState(tt.ghState)
			if got != tt.want {
				t.Errorf("mapStatusState(%q) = %q, want %q", tt.ghState, got, tt.want)
			}
		})
	}
}

func TestGitLabResponder_StatusSkippedWithoutSHA(t *testing.T) {
	// If head_sha is missing, status should be skipped (no API call)
	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.WriteHeader(200)
	}))
	defer srv.Close()

	resp := NewGitLabResponder(srv.URL, "token")
	ev := &event.Event{
		Type: "merge_request.opened",
		Attrs: event.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
			// No head_sha
		},
	}
	res := policy.Result{
		Status: &policy.StatusAction{State: "success", Description: "ok"},
	}

	err := resp.Respond(context.Background(), ev, res)
	if err != nil {
		t.Fatalf("Respond() error = %v", err)
	}
	if callCount != 0 {
		t.Errorf("expected 0 API calls when head_sha missing, got %d", callCount)
	}
}

func TestGitLabResponder_LabelsEmptyLists(t *testing.T) {
	// Labels with empty add/remove lists should not trigger API call
	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.WriteHeader(200)
	}))
	defer srv.Close()

	resp := NewGitLabResponder(srv.URL, "token")
	ev := &event.Event{
		Type: "merge_request.opened",
		Attrs: event.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
		},
	}
	res := policy.Result{
		Labels: &policy.LabelAction{Add: nil, Remove: nil},
	}

	err := resp.Respond(context.Background(), ev, res)
	if err != nil {
		t.Fatalf("Respond() error = %v", err)
	}
	if callCount != 0 {
		t.Errorf("expected 0 API calls for empty label lists, got %d", callCount)
	}
}

func TestGitLabResponder_IssueEndpoints(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.RequestURI
		w.WriteHeader(201)
	}))
	defer srv.Close()

	resp := NewGitLabResponder(srv.URL, "token")
	ev := &event.Event{
		Type: "issue.opened",
		Attrs: event.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     99,
		},
	}
	// Comment on an issue
	res := policy.Result{Output: "Looks like a bug"}
	err := resp.Respond(context.Background(), ev, res)
	if err != nil {
		t.Fatalf("Respond() error = %v", err)
	}
	wantPath := "/projects/org%2Frepo/issues/99/notes"
	if gotPath != wantPath {
		t.Errorf("path = %q, want %q", gotPath, wantPath)
	}
}

func TestGitLabResponder_APIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(403)
		w.Write([]byte(`{"message":"forbidden"}`))
	}))
	defer srv.Close()

	resp := NewGitLabResponder(srv.URL, "bad-token")
	ev := &event.Event{
		Type: "merge_request.opened",
		Attrs: event.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
		},
	}
	res := policy.Result{Output: "test"}
	err := resp.Respond(context.Background(), ev, res)
	if err == nil {
		t.Fatal("expected error for 403 response")
	}
	if !strings.Contains(err.Error(), "403") {
		t.Errorf("error = %q, want containing 403", err.Error())
	}
}

func TestGitLabResponder_PrivateTokenHeader(t *testing.T) {
	var gotToken string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotToken = r.Header.Get("PRIVATE-TOKEN")
		w.WriteHeader(201)
	}))
	defer srv.Close()

	resp := NewGitLabResponder(srv.URL, "glpat-secrettoken123")
	ev := &event.Event{
		Type: "merge_request.opened",
		Attrs: event.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     1,
		},
	}
	res := policy.Result{Output: "test"}
	resp.Respond(context.Background(), ev, res)

	if gotToken != "glpat-secrettoken123" {
		t.Errorf("PRIVATE-TOKEN = %q, want %q", gotToken, "glpat-secrettoken123")
	}
}

func TestGitLabResponder_MissingRepoInfo(t *testing.T) {
	resp := NewGitLabResponder("https://gitlab.com/api/v4", "token")
	ev := &event.Event{
		Type:  "merge_request.opened",
		Attrs: event.Attrs{},
	}
	res := policy.Result{Output: "test"}
	err := resp.Respond(context.Background(), ev, res)
	if err == nil {
		t.Fatal("expected error when repo_owner/repo_name missing")
	}
	if !strings.Contains(err.Error(), "missing repo_owner/repo_name") {
		t.Errorf("error = %q", err.Error())
	}
}

func TestEncodeProject(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"owner/repo", "owner%2Frepo"},
		{"group/subgroup/repo", "group%2Fsubgroup%2Frepo"},
		{"simple", "simple"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := encodeProject(tt.input)
			if got != tt.want {
				t.Errorf("encodeProject(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestGitLabResponder_MultipleActions(t *testing.T) {
	// Test that multiple result fields trigger multiple API calls
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.RequestURI)
		w.WriteHeader(201)
	}))
	defer srv.Close()

	resp := NewGitLabResponder(srv.URL, "token")
	ev := &event.Event{
		Type: "merge_request.opened",
		Attrs: event.Attrs{
			"repo_owner": "org",
			"repo_name":  "repo",
			"number":     3,
			"head_sha":   "deadbeef",
		},
	}
	res := policy.Result{
		Output: "Review complete",
		Status: &policy.StatusAction{State: "success", Description: "approved"},
		Labels: &policy.LabelAction{Add: []string{"approved"}},
	}

	err := resp.Respond(context.Background(), ev, res)
	if err != nil {
		t.Fatalf("Respond() error = %v", err)
	}
	// Should have 3 calls: comment, status, labels
	if len(paths) != 3 {
		t.Errorf("API calls = %d, want 3; paths = %v", len(paths), paths)
	}
}
