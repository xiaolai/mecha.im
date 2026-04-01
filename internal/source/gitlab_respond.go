package source

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"mecha.im/internal/event"
	"mecha.im/internal/policy"
)

// GitLabResponder writes results back to GitLab merge requests and issues.
type GitLabResponder struct {
	apiBase string // e.g., "https://gitlab.com/api/v4"
	token   string // private access token
}

// NewGitLabResponder creates a responder for GitLab API write-back.
func NewGitLabResponder(apiBase, token string) *GitLabResponder {
	return &GitLabResponder{apiBase: strings.TrimRight(apiBase, "/"), token: token}
}

// Name returns "gitlab".
func (g *GitLabResponder) Name() string { return "gitlab" }

// Respond posts a comment to the merge request or issue referenced by the event.
func (g *GitLabResponder) Respond(ctx context.Context, ev *event.Event, res policy.Result) error {
	if res.Output == "" && res.Comment == nil {
		return nil
	}
	body := res.Output
	if res.Comment != nil {
		body = res.Comment.Body
	}
	if body == "" {
		return nil
	}

	owner, _ := ev.Attrs["repo_owner"].(string)
	repo, _ := ev.Attrs["repo_name"].(string)
	if owner == "" || repo == "" {
		return fmt.Errorf("gitlab respond: missing repo_owner/repo_name in event attrs")
	}
	project := owner + "/" + repo

	number := 0
	if n, ok := ev.Attrs["number"].(int); ok {
		number = n
	}
	if number == 0 {
		return fmt.Errorf("gitlab respond: missing number in event attrs")
	}

	// Determine endpoint: merge_request.* → MR notes, issue.* → issue notes
	var url string
	if strings.HasPrefix(ev.Type, "merge_request") || strings.HasPrefix(ev.Type, "note") {
		url = fmt.Sprintf("%s/projects/%s/merge_requests/%d/notes", g.apiBase, encodeProject(project), number)
	} else if strings.HasPrefix(ev.Type, "issue") {
		url = fmt.Sprintf("%s/projects/%s/issues/%d/notes", g.apiBase, encodeProject(project), number)
	} else {
		return fmt.Errorf("gitlab respond: unsupported event type %q", ev.Type)
	}

	payload, _ := json.Marshal(map[string]string{"body": body})
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("gitlab respond: create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("PRIVATE-TOKEN", g.token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("gitlab respond: post comment: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("gitlab respond: API returned %d", resp.StatusCode)
	}
	return nil
}

// encodeProject URL-encodes a GitLab project path (owner/repo → owner%2Frepo).
func encodeProject(path string) string {
	return strings.ReplaceAll(path, "/", "%2F")
}
