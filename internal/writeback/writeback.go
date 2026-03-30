package writeback

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"mecha.im/internal/event"
)

// TaskResult mirrors the worker result contract.
type TaskResult struct {
	Output  string         `json:"output"`
	Comment *CommentAction `json:"comment,omitempty"`
	Labels  *LabelAction   `json:"labels,omitempty"`
	Status  *StatusAction  `json:"status,omitempty"`
}

// CommentAction posts a comment to a PR or issue.
type CommentAction struct {
	Target string `json:"target"`
	Body   string `json:"body"`
}

// LabelAction adds or removes labels.
type LabelAction struct {
	Add    []string `json:"add,omitempty"`
	Remove []string `json:"remove,omitempty"`
}

// StatusAction sets a commit status.
type StatusAction struct {
	State       string `json:"state"`
	Description string `json:"description"`
}

// Client writes task results back to GitHub.
type Client struct {
	token  string
	http   *http.Client
	logger *slog.Logger
}

// NewClient creates a write-back client.
func NewClient(token string, logger *slog.Logger) *Client {
	if logger == nil {
		logger = slog.Default()
	}
	return &Client{
		token:  token,
		http:   &http.Client{Timeout: 30 * time.Second},
		logger: logger,
	}
}

// WriteBack parses the worker result and writes back to GitHub.
// Returns error if any write-back action fails.
func (c *Client) WriteBack(ctx context.Context, ev *event.Event, resultJSON string) error {
	if c == nil || c.token == "" {
		return nil
	}

	var result TaskResult
	if err := json.Unmarshal([]byte(resultJSON), &result); err != nil {
		c.logger.Warn("writeback: parse result", "event", ev.ID, "err", err)
		return nil
	}

	owner, repo := ev.RepoOwner, ev.RepoName
	var lastErr error

	if result.Comment != nil && result.Comment.Body != "" && ev.Number > 0 {
		if err := c.postComment(ctx, owner, repo, ev.Number, result.Comment.Body); err != nil {
			c.logger.Error("writeback: comment", "event", ev.ID, "err", err)
			lastErr = err
		}
	}

	if result.Status != nil && result.Status.State != "" {
		sha, _ := ev.Payload["head_sha"].(string)
		if sha != "" {
			if err := c.setStatus(ctx, owner, repo, sha, result.Status.State, result.Status.Description); err != nil {
				c.logger.Error("writeback: status", "event", ev.ID, "err", err)
				lastErr = err
			}
		}
	}

	if result.Labels != nil && ev.Number > 0 {
		for _, label := range result.Labels.Add {
			if err := c.addLabel(ctx, owner, repo, ev.Number, label); err != nil {
				c.logger.Error("writeback: add label", "label", label, "err", err)
				lastErr = err
			}
		}
		for _, label := range result.Labels.Remove {
			if err := c.removeLabel(ctx, owner, repo, ev.Number, label); err != nil {
				c.logger.Error("writeback: remove label", "label", label, "err", err)
				lastErr = err
			}
		}
	}

	return lastErr
}
