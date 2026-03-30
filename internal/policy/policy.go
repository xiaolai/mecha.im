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
	return res, Decision{Allowed: allowed}, nil
}
