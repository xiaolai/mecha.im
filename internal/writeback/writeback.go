package writeback

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"mecha.im/internal/event"
	"mecha.im/internal/policy"
)

// validStatusStates are the GitHub commit status API allowed values.
var validStatusStates = map[string]bool{
	"error": true, "failure": true, "pending": true, "success": true,
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

// WriteBackResult writes a policy-filtered result to GitHub.
func (c *Client) WriteBackResult(ctx context.Context, ev *event.Event, res policy.Result) error {
	if c == nil || c.token == "" {
		return nil
	}
	owner, repo := ev.RepoOwner, ev.RepoName
	var errs []error

	if res.Comment != nil && res.Comment.Body != "" && ev.Number > 0 {
		if err := c.postComment(ctx, owner, repo, ev.Number, res.Comment.Body); err != nil {
			c.logger.Error("writeback: comment", "event", ev.ID, "err", err)
			errs = append(errs, err)
		}
	}
	if res.Status != nil && res.Status.State != "" {
		if !validStatusStates[res.Status.State] {
			c.logger.Warn("writeback: invalid status state, skipping", "event", ev.ID, "state", res.Status.State)
		} else {
			sha, _ := ev.Payload["head_sha"].(string)
			if sha != "" {
				if err := c.setStatus(ctx, owner, repo, sha, res.Status.State, res.Status.Description); err != nil {
					c.logger.Error("writeback: status", "event", ev.ID, "err", err)
					errs = append(errs, err)
				}
			}
		}
	}
	if res.Labels != nil && ev.Number > 0 {
		for _, label := range res.Labels.Add {
			if err := c.addLabel(ctx, owner, repo, ev.Number, label); err != nil {
				c.logger.Error("writeback: add label", "label", label, "err", err)
				errs = append(errs, err)
			}
		}
		for _, label := range res.Labels.Remove {
			if err := c.removeLabel(ctx, owner, repo, ev.Number, label); err != nil {
				c.logger.Error("writeback: remove label", "label", label, "err", err)
				errs = append(errs, err)
			}
		}
	}
	if res.Commit != nil && res.Commit.Diff != "" && ev.Number > 0 {
		if err := c.postCommitSuggestion(ctx, owner, repo, ev.Number, res.Commit.Message, res.Commit.Diff); err != nil {
			c.logger.Error("writeback: commit suggestion", "event", ev.ID, "err", err)
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
