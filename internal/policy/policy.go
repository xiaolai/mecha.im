package policy

import (
	"context"

	"mecha.im/internal/event"
)

// Decision records what the policy allowed and denied.
type Decision struct {
	Allowed []string `json:"allowed,omitempty"`
	Denied  []string `json:"denied,omitempty"`
}

// Filter decides what parts of a worker result are allowed through.
type Filter interface {
	Apply(ctx context.Context, ev *event.Event, res Result) (Result, Decision, error)
}

// DenyAll blocks all write-back actions. Used when policy config is invalid.
type DenyAll struct{}

// Apply returns an empty result with all actions denied.
func (d *DenyAll) Apply(_ context.Context, _ *event.Event, res Result) (Result, Decision, error) {
	var denied []string
	if res.Comment != nil {
		denied = append(denied, "comment: denied (invalid policy config)")
	}
	if res.Labels != nil {
		denied = append(denied, "labels: denied (invalid policy config)")
	}
	if res.Status != nil {
		denied = append(denied, "status: denied (invalid policy config)")
	}
	if res.Commit != nil {
		denied = append(denied, "commit: denied (invalid policy config)")
	}
	if res.Metadata != nil {
		denied = append(denied, "metadata: denied (invalid policy config)")
	}
	return Result{Output: res.Output}, Decision{Denied: denied}, nil
}

// AllowAll passes everything through. Used when no policy is configured.
type AllowAll struct{}

// Apply returns the result unchanged with all actions allowed.
func (a *AllowAll) Apply(_ context.Context, _ *event.Event, res Result) (Result, Decision, error) {
	var allowed []string
	if res.Comment != nil {
		allowed = append(allowed, "comment")
	}
	if res.Labels != nil {
		allowed = append(allowed, "labels")
	}
	if res.Status != nil {
		allowed = append(allowed, "status")
	}
	if res.Commit != nil {
		allowed = append(allowed, "commit")
	}
	if res.Metadata != nil {
		allowed = append(allowed, "metadata")
	}
	return res, Decision{Allowed: allowed}, nil
}
