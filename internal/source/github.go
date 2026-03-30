package source

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"mecha.im/internal/event"
)

// GitHubSource parses GitHub webhook payloads into events.
type GitHubSource struct {
	secret string
	token  string
}

// NewGitHubSource creates a GitHub webhook source.
// secret is for HMAC validation (empty = skip validation).
// token is for API calls during hydration.
func NewGitHubSource(secret, token string) *GitHubSource {
	return &GitHubSource{secret: secret, token: token}
}

// Name returns "github".
func (g *GitHubSource) Name() string { return "github" }

// Parse validates the HMAC signature and normalizes the webhook payload.
// No network calls — hydration is separate.
func (g *GitHubSource) Parse(headers http.Header, body []byte) (*event.Event, error) {
	if g.secret != "" {
		sig := headers.Get("X-Hub-Signature-256")
		if !validateSignature(g.secret, body, sig) {
			return nil, fmt.Errorf("invalid webhook signature")
		}
	}

	ghEvent := headers.Get("X-GitHub-Event")
	if ghEvent == "" {
		return nil, fmt.Errorf("missing X-GitHub-Event header")
	}
	deliveryID := headers.Get("X-GitHub-Delivery")

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("parse webhook body: %w", err)
	}

	action, _ := payload["action"].(string)
	eventType := ghEvent
	if action != "" {
		eventType = ghEvent + "." + action
	}

	ev := &event.Event{
		DeliveryID: deliveryID,
		Source:     "github",
		Type:       eventType,
		Raw:        json.RawMessage(body),
		Payload:    make(event.Payload),
	}

	// Extract common fields
	if repo, ok := payload["repository"].(map[string]any); ok {
		if full, ok := repo["full_name"].(string); ok {
			parts := strings.SplitN(full, "/", 2)
			if len(parts) == 2 {
				ev.RepoOwner = parts[0]
				ev.RepoName = parts[1]
			}
		}
	}
	if sender, ok := payload["sender"].(map[string]any); ok {
		ev.Sender, _ = sender["login"].(string)
	}

	// Event-specific extraction
	switch ghEvent {
	case "pull_request":
		parsePullRequest(payload, ev)
	case "push":
		parsePush(payload, ev)
	case "issues":
		parseIssue(payload, ev)
	case "issue_comment":
		parseIssueComment(payload, ev)
	}

	return ev, nil
}

func parsePullRequest(payload map[string]any, ev *event.Event) {
	pr, _ := payload["pull_request"].(map[string]any)
	if pr == nil {
		return
	}
	ev.Number = intVal(pr["number"])
	ev.Payload["number"] = ev.Number
	ev.Payload["title"], _ = pr["title"].(string)
	ev.Payload["body"], _ = pr["body"].(string)
	if head, ok := pr["head"].(map[string]any); ok {
		ev.Ref, _ = head["sha"].(string)
		ev.Payload["head_sha"] = ev.Ref
		ev.Payload["head_branch"], _ = head["ref"].(string)
	}
	if base, ok := pr["base"].(map[string]any); ok {
		ev.Payload["base_branch"], _ = base["ref"].(string)
	}
	if labels, ok := pr["labels"].([]any); ok {
		var names []string
		for _, l := range labels {
			if lm, ok := l.(map[string]any); ok {
				if n, ok := lm["name"].(string); ok {
					names = append(names, n)
				}
			}
		}
		ev.Payload["labels"] = strings.Join(names, ", ")
	}
}

func parsePush(payload map[string]any, ev *event.Event) {
	ev.Ref, _ = payload["ref"].(string)
	ev.Payload["ref"] = ev.Ref
	if after, ok := payload["after"].(string); ok {
		ev.Payload["head_sha"] = after
	}
	if compare, ok := payload["compare"].(string); ok {
		ev.Payload["compare_url"] = compare
	}
	if commits, ok := payload["commits"].([]any); ok {
		var msgs []string
		for _, c := range commits {
			if cm, ok := c.(map[string]any); ok {
				id, _ := cm["id"].(string)
				msg, _ := cm["message"].(string)
				if len(id) > 8 {
					id = id[:8]
				}
				msgs = append(msgs, id+" "+msg)
			}
		}
		ev.Payload["commits"] = strings.Join(msgs, "\n")
	}
}

func parseIssue(payload map[string]any, ev *event.Event) {
	issue, _ := payload["issue"].(map[string]any)
	if issue == nil {
		return
	}
	ev.Number = intVal(issue["number"])
	ev.Payload["number"] = ev.Number
	ev.Payload["title"], _ = issue["title"].(string)
	ev.Payload["body"], _ = issue["body"].(string)
}

func parseIssueComment(payload map[string]any, ev *event.Event) {
	if issue, ok := payload["issue"].(map[string]any); ok {
		ev.Number = intVal(issue["number"])
		ev.Payload["number"] = ev.Number
		ev.Payload["title"], _ = issue["title"].(string)
	}
	if comment, ok := payload["comment"].(map[string]any); ok {
		ev.Payload["comment"], _ = comment["body"].(string)
	}
}

func validateSignature(secret string, body []byte, sig string) bool {
	if !strings.HasPrefix(sig, "sha256=") {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(sig))
}

