package source

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"mecha.im/internal/events"
	"mecha.im/internal/policies"
)

// GitLabResponder writes results back to GitLab merge requests and issues.
type GitLabResponder struct {
	apiBase string // e.g., "https://gitlab.com/api/v4"
	token   string // private access token
	http    *http.Client
}

// NewGitLabResponder creates a responder for GitLab API write-back.
func NewGitLabResponder(apiBase, token string) *GitLabResponder {
	return &GitLabResponder{
		apiBase: strings.TrimRight(apiBase, "/"),
		token:   token,
		http:    &http.Client{Timeout: 30 * time.Second},
	}
}

// Name returns "gitlab".
func (g *GitLabResponder) Name() string { return "gitlab" }

// Respond posts results to the merge request or issue referenced by the event.
func (g *GitLabResponder) Respond(ctx context.Context, ev *events.Event, res policies.Result) error {
	// Short-circuit if there's nothing to write back.
	if res.Output == "" && res.Comment == nil && res.Status == nil && res.Labels == nil && res.Commit == nil {
		return nil
	}

	project, number, err := g.extractTarget(ev)
	if err != nil {
		return err
	}

	var errs []error

	if body := commentBody(res); body != "" && number > 0 {
		if err := g.postNote(ctx, ev, project, number, body); err != nil {
			errs = append(errs, fmt.Errorf("comment: %w", err))
		}
	}
	if res.Status != nil && res.Status.State != "" {
		sha, _ := ev.Attrs["head_sha"].(string)
		if sha != "" {
			if err := g.setCommitStatus(ctx, project, sha, res.Status.State, res.Status.Description); err != nil {
				errs = append(errs, fmt.Errorf("status: %w", err))
			}
		}
	}
	if res.Labels != nil && number > 0 {
		if err := g.updateLabels(ctx, ev, project, number, res.Labels); err != nil {
			errs = append(errs, fmt.Errorf("labels: %w", err))
		}
	}
	if res.Commit != nil && res.Commit.Diff != "" && number > 0 {
		body := fmt.Sprintf("**Suggested commit:** %s\n\n```diff\n%s\n```", res.Commit.Message, res.Commit.Diff)
		if err := g.postNote(ctx, ev, project, number, body); err != nil {
			errs = append(errs, fmt.Errorf("commit suggestion: %w", err))
		}
	}
	return errors.Join(errs...)
}

func (g *GitLabResponder) extractTarget(ev *events.Event) (string, int, error) {
	owner, _ := ev.Attrs["repo_owner"].(string)
	repo, _ := ev.Attrs["repo_name"].(string)
	if owner == "" || repo == "" {
		return "", 0, fmt.Errorf("gitlab respond: missing repo_owner/repo_name")
	}
	number := intVal(ev.Attrs["number"])
	return owner + "/" + repo, number, nil
}

func (g *GitLabResponder) postNote(ctx context.Context, ev *events.Event, project string, number int, body string) error {
	var url string
	if strings.HasPrefix(ev.Type, "merge_request") || strings.HasPrefix(ev.Type, "note") {
		url = fmt.Sprintf("%s/projects/%s/merge_requests/%d/notes", g.apiBase, encodeProject(project), number)
	} else {
		url = fmt.Sprintf("%s/projects/%s/issues/%d/notes", g.apiBase, encodeProject(project), number)
	}
	payload, _ := json.Marshal(map[string]string{"body": body})
	return g.doRequest(ctx, "POST", url, payload)
}

func (g *GitLabResponder) setCommitStatus(ctx context.Context, project, sha, state, desc string) error {
	glState := mapStatusState(state)
	url := fmt.Sprintf("%s/projects/%s/statuses/%s", g.apiBase, encodeProject(project), sha)
	payload, _ := json.Marshal(map[string]string{
		"state":       glState,
		"description": desc,
		"name":        "mecha",
	})
	return g.doRequest(ctx, "POST", url, payload)
}

func (g *GitLabResponder) updateLabels(ctx context.Context, ev *events.Event, project string, number int, labels *policies.LabelAction) error {
	if labels == nil || (len(labels.Add) == 0 && len(labels.Remove) == 0) {
		return nil
	}
	// GitLab uses PUT with comma-separated label lists on MR/issue endpoint
	var endpoint string
	if strings.HasPrefix(ev.Type, "merge_request") || strings.HasPrefix(ev.Type, "note") {
		endpoint = fmt.Sprintf("%s/projects/%s/merge_requests/%d", g.apiBase, encodeProject(project), number)
	} else {
		endpoint = fmt.Sprintf("%s/projects/%s/issues/%d", g.apiBase, encodeProject(project), number)
	}
	body := make(map[string]string)
	if len(labels.Add) > 0 {
		body["add_labels"] = strings.Join(labels.Add, ",")
	}
	if len(labels.Remove) > 0 {
		body["remove_labels"] = strings.Join(labels.Remove, ",")
	}
	payload, _ := json.Marshal(body)
	return g.doRequest(ctx, "PUT", endpoint, payload)
}

func (g *GitLabResponder) doRequest(ctx context.Context, method, url string, payload []byte) error {
	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("PRIVATE-TOKEN", g.token)

	resp, err := g.http.Do(req)
	if err != nil {
		return fmt.Errorf("gitlab api: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("gitlab %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

func commentBody(res policies.Result) string {
	if res.Comment != nil && res.Comment.Body != "" {
		return res.Comment.Body
	}
	return res.Output
}

// mapStatusState maps GitHub status states to GitLab commit status states.
// GitHub: error, failure, pending, success
// GitLab: pending, running, success, failed, canceled
func mapStatusState(ghState string) string {
	switch ghState {
	case "error", "failure":
		return "failed"
	case "pending":
		return "pending"
	case "success":
		return "success"
	default:
		return "failed"
	}
}

// encodeProject URL-encodes a GitLab project path (owner/repo → owner%2Frepo).
func encodeProject(path string) string {
	return strings.ReplaceAll(path, "/", "%2F")
}
