package source

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"mecha.im/internal/events"
)

// GitLabSource parses GitLab webhook payloads into events.
type GitLabSource struct {
	secret string
}

// NewGitLabSource creates a GitLab webhook source.
// secret is matched against X-Gitlab-Token header (empty = skip validation).
func NewGitLabSource(secret string) *GitLabSource {
	return &GitLabSource{secret: secret}
}

// Name returns "gitlab".
func (g *GitLabSource) Name() string { return "gitlab" }

// Authenticated marks GitLab as self-authenticating (token comparison).
func (g *GitLabSource) Authenticated() {}

// Parse validates the token and normalizes the webhook payload.
func (g *GitLabSource) Parse(headers http.Header, body []byte) (*events.Event, error) {
	if g.secret != "" {
		token := headers.Get("X-Gitlab-Token")
		if subtle.ConstantTimeCompare([]byte(token), []byte(g.secret)) != 1 {
			return nil, fmt.Errorf("invalid gitlab webhook token")
		}
	}

	glEvent := headers.Get("X-Gitlab-Event")
	if glEvent == "" {
		return nil, fmt.Errorf("missing X-Gitlab-Event header")
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("parse webhook body: %w", err)
	}

	eventType := normalizeGitLabEvent(glEvent, payload)

	// Prefer X-Gitlab-Event-UUID (idempotency key) over X-Request-Id (correlation)
	deliveryID := headers.Get("X-Gitlab-Event-UUID")
	if deliveryID == "" {
		deliveryID = headers.Get("X-Gitlab-Instance") + "/" + headers.Get("X-Request-Id")
		if deliveryID == "/" {
			deliveryID = ""
		}
	}

	ev := &events.Event{
		DeliveryID: deliveryID,
		Source:     "gitlab",
		Type:       eventType,
		Raw:        json.RawMessage(body),
		Attrs:      make(events.Attrs),
	}

	// Extract Actor — top-level user_username preferred per GitLab docs
	if username, ok := payload["user_username"].(string); ok && username != "" {
		ev.Actor = username
	} else if user, ok := payload["user"].(map[string]any); ok {
		ev.Actor, _ = user["username"].(string)
	}

	// Extract Subject (owner/repo)
	if project, ok := payload["project"].(map[string]any); ok {
		if ns, ok := project["path_with_namespace"].(string); ok {
			ev.Subject = ns
			parts := strings.SplitN(ns, "/", 2)
			if len(parts) == 2 {
				ev.Attrs["repo_owner"] = parts[0]
				ev.Attrs["repo_name"] = parts[1]
			}
		}
	}
	ev.Attrs["sender"] = ev.Actor

	switch glEvent {
	case "Merge Request Hook":
		parseGitLabMergeRequest(payload, ev)
	case "Push Hook", "Tag Push Hook":
		parseGitLabPush(payload, ev)
	case "Note Hook":
		parseGitLabNote(payload, ev)
	case "Issue Hook":
		parseGitLabIssue(payload, ev)
	}

	return ev, nil
}

func normalizeGitLabEvent(glEvent string, payload map[string]any) string {
	switch glEvent {
	case "Merge Request Hook":
		action, _ := payload["object_attributes"].(map[string]any)
		if action != nil {
			if a, ok := action["action"].(string); ok {
				return "merge_request." + a
			}
		}
		return "merge_request"
	case "Push Hook":
		return "push"
	case "Tag Push Hook":
		return "tag_push"
	case "Note Hook":
		return "note"
	case "Issue Hook":
		action, _ := payload["object_attributes"].(map[string]any)
		if action != nil {
			if a, ok := action["action"].(string); ok {
				return "issue." + a
			}
		}
		return "issue"
	default:
		return strings.ToLower(strings.ReplaceAll(glEvent, " ", "_"))
	}
}

func parseGitLabMergeRequest(payload map[string]any, ev *events.Event) {
	attrs, _ := payload["object_attributes"].(map[string]any)
	if attrs == nil {
		return
	}
	ev.Attrs["number"] = intVal(attrs["iid"])
	ev.Attrs["title"], _ = attrs["title"].(string)
	ev.Attrs["body"], _ = attrs["description"].(string)
	if src, ok := attrs["source_branch"].(string); ok {
		ev.Attrs["head_branch"] = src
	}
	if tgt, ok := attrs["target_branch"].(string); ok {
		ev.Attrs["base_branch"] = tgt
	}
	if sha, ok := attrs["last_commit"].(map[string]any); ok {
		if id, ok := sha["id"].(string); ok {
			ev.Attrs["ref"] = id
			ev.Attrs["head_sha"] = id
		}
	}
}

func parseGitLabPush(payload map[string]any, ev *events.Event) {
	ref, _ := payload["ref"].(string)
	ev.Attrs["ref"] = ref
	if after, ok := payload["after"].(string); ok {
		ev.Attrs["head_sha"] = after
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
		ev.Attrs["commits"] = strings.Join(msgs, "\n")
	}
}

func parseGitLabNote(payload map[string]any, ev *events.Event) {
	attrs, _ := payload["object_attributes"].(map[string]any)
	if attrs != nil {
		ev.Attrs["comment"], _ = attrs["note"].(string)
	}
	if mr, ok := payload["merge_request"].(map[string]any); ok {
		ev.Attrs["number"] = intVal(mr["iid"])
		ev.Attrs["title"], _ = mr["title"].(string)
	} else if issue, ok := payload["issue"].(map[string]any); ok {
		ev.Attrs["number"] = intVal(issue["iid"])
		ev.Attrs["title"], _ = issue["title"].(string)
	}
}

func parseGitLabIssue(payload map[string]any, ev *events.Event) {
	attrs, _ := payload["object_attributes"].(map[string]any)
	if attrs == nil {
		return
	}
	ev.Attrs["number"] = intVal(attrs["iid"])
	ev.Attrs["title"], _ = attrs["title"].(string)
	ev.Attrs["body"], _ = attrs["description"].(string)
}
