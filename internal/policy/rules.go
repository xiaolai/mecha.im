package policy

import (
	"context"
	"fmt"
	"unicode/utf8"

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

// parseBoolField extracts a bool from a map, returning an error if the value
// exists but is not a bool (e.g. "yes" or 1).
func parseBoolField(m map[string]any, key, section string) (bool, error) {
	v, ok := m[key]
	if !ok {
		return false, nil
	}
	b, ok := v.(bool)
	if !ok {
		return false, fmt.Errorf("policy.%s.%s must be a boolean, got %T(%v)", section, key, v, v)
	}
	return b, nil
}

// ParseRules converts a raw YAML map into a RuleFilter.
// Returns AllowAll if the map is nil or empty.
// Returns an error if field types are wrong (e.g. allow: "yes").
func ParseRules(raw map[string]any) (Filter, error) {
	if len(raw) == 0 {
		return &AllowAll{}, nil
	}
	r := &RuleFilter{}
	if cm, ok := raw["comment"].(map[string]any); ok {
		r.Comment = &CommentPolicy{}
		allow, err := parseBoolField(cm, "allow", "comment")
		if err != nil {
			return nil, err
		}
		r.Comment.Allow = allow
		if ml, ok := cm["max_length"].(int); ok {
			r.Comment.MaxLength = ml
		} else if ml, ok := cm["max_length"].(float64); ok {
			r.Comment.MaxLength = int(ml)
		}
	}
	if lm, ok := raw["labels"].(map[string]any); ok {
		r.Labels = &LabelPolicy{}
		allow, err := parseBoolField(lm, "allow", "labels")
		if err != nil {
			return nil, err
		}
		r.Labels.Allow = allow
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
		allow, err := parseBoolField(sm, "allow", "status")
		if err != nil {
			return nil, err
		}
		r.Status.Allow = allow
	}
	if cm, ok := raw["commit"].(map[string]any); ok {
		r.Commit = &CommitPolicy{}
		allow, err := parseBoolField(cm, "allow", "commit")
		if err != nil {
			return nil, err
		}
		r.Commit.Allow = allow
	}
	return r, nil
}

// Apply filters the result according to the configured rules.
func (r *RuleFilter) Apply(_ context.Context, _ *event.Event, res Result) (Result, Decision, error) {
	var d Decision
	filtered := res

	// Comment — deep-copy before mutation to avoid modifying the caller's data
	if filtered.Comment != nil {
		if r.Comment == nil || r.Comment.Allow {
			if r.Comment != nil && r.Comment.MaxLength > 0 && utf8.RuneCountInString(filtered.Comment.Body) > r.Comment.MaxLength {
				runes := []rune(filtered.Comment.Body)
				cc := *filtered.Comment
				cc.Body = string(runes[:r.Comment.MaxLength]) + "\n\n... (truncated by policy)"
				filtered.Comment = &cc
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
	var filteredRemove []string
	for _, l := range labels.Remove {
		if blocked[l] {
			d.Denied = append(d.Denied, fmt.Sprintf("label remove %q: blocked by policy", l))
		} else {
			filteredRemove = append(filteredRemove, l)
		}
	}
	result := &LabelAction{Add: filteredAdd, Remove: filteredRemove}
	if len(filteredAdd) > 0 || len(filteredRemove) > 0 {
		d.Allowed = append(d.Allowed, "labels")
	}
	return result
}
