package policy

import (
	"context"
	"fmt"

	"mecha.im/internal/event"
)

// RuleFilter applies per-worker policy rules to filter results.
type RuleFilter struct {
	Comment *CommentPolicy `yaml:"comment" json:"comment,omitempty"`
	Labels  *LabelPolicy   `yaml:"labels" json:"labels,omitempty"`
	Status  *StatusPolicy  `yaml:"status" json:"status,omitempty"`
	Commit  *CommitPolicy  `yaml:"commit" json:"commit,omitempty"`
}

// CommentPolicy controls PR/issue comment write-back.
type CommentPolicy struct {
	Allow     bool `yaml:"allow" json:"allow"`
	MaxLength int  `yaml:"max_length,omitempty" json:"max_length,omitempty"`
}

// LabelPolicy controls label add/remove write-back.
type LabelPolicy struct {
	Allow   bool     `yaml:"allow" json:"allow"`
	Blocked []string `yaml:"blocked,omitempty" json:"blocked,omitempty"`
}

// StatusPolicy controls commit status write-back.
type StatusPolicy struct {
	Allow bool `yaml:"allow" json:"allow"`
}

// CommitPolicy controls code change suggestions.
type CommitPolicy struct {
	Allow bool `yaml:"allow" json:"allow"`
}

// ParseRules converts a raw YAML map into a RuleFilter.
// Returns AllowAll if the map is nil or empty.
func ParseRules(raw map[string]any) Filter {
	if len(raw) == 0 {
		return &AllowAll{}
	}
	r := &RuleFilter{}
	if cm, ok := raw["comment"].(map[string]any); ok {
		r.Comment = &CommentPolicy{}
		r.Comment.Allow, _ = cm["allow"].(bool)
		if ml, ok := cm["max_length"].(int); ok {
			r.Comment.MaxLength = ml
		} else if ml, ok := cm["max_length"].(float64); ok {
			r.Comment.MaxLength = int(ml)
		}
	}
	if lm, ok := raw["labels"].(map[string]any); ok {
		r.Labels = &LabelPolicy{}
		r.Labels.Allow, _ = lm["allow"].(bool)
		if bl, ok := lm["blocked"].([]any); ok {
			for _, b := range bl {
				if s, ok := b.(string); ok {
					r.Labels.Blocked = append(r.Labels.Blocked, s)
				}
			}
		}
	}
	if sm, ok := raw["status"].(map[string]any); ok {
		r.Status = &StatusPolicy{}
		r.Status.Allow, _ = sm["allow"].(bool)
	}
	if cm, ok := raw["commit"].(map[string]any); ok {
		r.Commit = &CommitPolicy{}
		r.Commit.Allow, _ = cm["allow"].(bool)
	}
	return r
}

// Apply filters the result according to the configured rules.
func (r *RuleFilter) Apply(_ context.Context, _ *event.Event, res Result) (Result, Decision, error) {
	var d Decision
	filtered := res

	// Comment
	if filtered.Comment != nil {
		if r.Comment == nil || r.Comment.Allow {
			if r.Comment != nil && r.Comment.MaxLength > 0 && len(filtered.Comment.Body) > r.Comment.MaxLength {
				filtered.Comment.Body = filtered.Comment.Body[:r.Comment.MaxLength] + "\n\n... (truncated by policy)"
				d.Allowed = append(d.Allowed, "comment (truncated)")
			} else {
				d.Allowed = append(d.Allowed, "comment")
			}
		} else {
			filtered.Comment = nil
			d.Denied = append(d.Denied, "comment: blocked by policy")
		}
	}

	// Labels
	if filtered.Labels != nil {
		if r.Labels == nil || r.Labels.Allow {
			filtered.Labels = filterLabels(filtered.Labels, r.Labels, &d)
		} else {
			filtered.Labels = nil
			d.Denied = append(d.Denied, "labels: blocked by policy")
		}
	}

	// Status
	if filtered.Status != nil {
		if r.Status == nil || r.Status.Allow {
			d.Allowed = append(d.Allowed, "status")
		} else {
			filtered.Status = nil
			d.Denied = append(d.Denied, "status: blocked by policy")
		}
	}

	// Commit
	if filtered.Commit != nil {
		if r.Commit == nil || r.Commit.Allow {
			d.Allowed = append(d.Allowed, "commit")
		} else {
			filtered.Commit = nil
			d.Denied = append(d.Denied, "commit: blocked by policy")
		}
	}

	return filtered, d, nil
}

func filterLabels(labels *LabelAction, policy *LabelPolicy, d *Decision) *LabelAction {
	if policy == nil || len(policy.Blocked) == 0 {
		d.Allowed = append(d.Allowed, "labels")
		return labels
	}
	blocked := make(map[string]bool)
	for _, b := range policy.Blocked {
		blocked[b] = true
	}
	var filteredAdd []string
	for _, l := range labels.Add {
		if blocked[l] {
			d.Denied = append(d.Denied, fmt.Sprintf("label add %q: blocked by policy", l))
		} else {
			filteredAdd = append(filteredAdd, l)
		}
	}
	result := &LabelAction{Add: filteredAdd, Remove: labels.Remove}
	if len(filteredAdd) > 0 || len(labels.Remove) > 0 {
		d.Allowed = append(d.Allowed, "labels")
	}
	return result
}
