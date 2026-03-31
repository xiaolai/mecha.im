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
// Implements source.Responder.
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

// Name returns "github" (implements source.Responder).
func (c *Client) Name() string { return "github" }

// Respond writes a policy-filtered result back to GitHub.
// Implements source.Responder.
func (c *Client) Respond(ctx context.Context, ev *event.Event, res policy.Result) error {
	return c.WriteBackResult(ctx, ev, res)
}

// WriteBackResult writes a policy-filtered result to GitHub.
func (c *Client) WriteBackResult(ctx context.Context, ev *event.Event, res policy.Result) error {
	if c == nil || c.token == "" {
		return nil
	}
	owner, _ := ev.Attrs["repo_owner"].(string)
	repo, _ := ev.Attrs["repo_name"].(string)
	number := attrInt(ev.Attrs, "number")

	var errs []error

	if res.Comment != nil && res.Comment.Body != "" && number > 0 {
		if err := c.postComment(ctx, owner, repo, number, res.Comment.Body); err != nil {
			c.logger.Error("writeback: comment", "event", ev.ID, "err", err)
			errs = append(errs, err)
		}
	}
	if res.Status != nil && res.Status.State != "" {
		if !validStatusStates[res.Status.State] {
			c.logger.Warn("writeback: invalid status state, skipping", "event", ev.ID, "state", res.Status.State)
		} else {
			sha, _ := ev.Attrs["head_sha"].(string)
			if sha != "" {
				if err := c.setStatus(ctx, owner, repo, sha, res.Status.State, res.Status.Description); err != nil {
					c.logger.Error("writeback: status", "event", ev.ID, "err", err)
					errs = append(errs, err)
				}
			}
		}
	}
	if res.Labels != nil && number > 0 {
		for _, label := range res.Labels.Add {
			if err := c.addLabel(ctx, owner, repo, number, label); err != nil {
				c.logger.Error("writeback: add label", "label", label, "err", err)
				errs = append(errs, err)
			}
		}
		for _, label := range res.Labels.Remove {
			if err := c.removeLabel(ctx, owner, repo, number, label); err != nil {
				c.logger.Error("writeback: remove label", "label", label, "err", err)
				errs = append(errs, err)
			}
		}
	}
	if res.Commit != nil && res.Commit.Diff != "" && number > 0 {
		if err := c.postCommitSuggestion(ctx, owner, repo, number, res.Commit.Message, res.Commit.Diff); err != nil {
			c.logger.Error("writeback: commit suggestion", "event", ev.ID, "err", err)
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// attrInt extracts an integer from Attrs (handles float64 from JSON).
func attrInt(attrs event.Attrs, key string) int {
	switch n := attrs[key].(type) {
	case float64:
		return int(n)
	case int:
		return n
	default:
		return 0
	}
}
