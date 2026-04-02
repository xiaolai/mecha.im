package policy

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"mecha.im/internal/event"
)

// RuleFilter applies per-worker policy rules to filter results.
type RuleFilter struct {
	Comment  *CommentPolicy  `yaml:"comment" json:"comment,omitempty"`
	Labels   *LabelPolicy    `yaml:"labels" json:"labels,omitempty"`
	Status   *StatusPolicy   `yaml:"status" json:"status,omitempty"`
	Commit   *CommitPolicy   `yaml:"commit" json:"commit,omitempty"`
	Metadata *MetadataPolicy `yaml:"metadata" json:"metadata,omitempty"`
}

// CommentPolicy controls PR/issue comment write-back.
type CommentPolicy struct {
	Allow     bool `yaml:"allow" json:"allow"`
	MaxLength int  `yaml:"max_length,omitempty" json:"max_length,omitempty"`
}

// LabelPolicy controls label add/remove write-back.
type LabelPolicy struct {
	Allow   bool     `yaml:"allow" json:"allow"`
	Allowed []string `yaml:"allowed,omitempty" json:"allowed,omitempty"` // allowlist (restrictive)
	Blocked []string `yaml:"blocked,omitempty" json:"blocked,omitempty"` // blocklist (permissive)
}

// StatusPolicy controls commit status write-back.
type StatusPolicy struct {
	Allow bool `yaml:"allow" json:"allow"`
}

// CommitPolicy controls code change suggestions.
type CommitPolicy struct {
	Allow   bool `yaml:"allow" json:"allow"`
	MaxSize int  `yaml:"max_size,omitempty" json:"max_size,omitempty"` // max diff bytes
}

// MetadataPolicy controls whether metadata is included in the result.
type MetadataPolicy struct {
	Allow bool `yaml:"allow" json:"allow"`
}

const truncationSuffix = "\n\n... (truncated by policy)"

// Apply filters the result according to the configured rules.
func (r *RuleFilter) Apply(_ context.Context, _ *event.Event, res Result) (Result, Decision, error) {
	var d Decision
	filtered := res

	filtered.Comment = r.applyComment(filtered.Comment, &d)
	filtered.Labels = r.applyLabels(filtered.Labels, &d)
	filtered.Status = r.applyStatus(filtered.Status, &d)
	filtered.Commit = r.applyCommit(filtered.Commit, &d)
	filtered.Metadata = r.applyMetadata(filtered.Metadata, &d)

	return filtered, d, nil
}

func (r *RuleFilter) applyComment(c *CommentAction, d *Decision) *CommentAction {
	if c == nil {
		return nil
	}
	if r.Comment != nil && !r.Comment.Allow {
		d.Denied = append(d.Denied, "comment: blocked by policy")
		return nil
	}
	if r.Comment != nil && r.Comment.MaxLength > 0 && utf8.RuneCountInString(c.Body) > r.Comment.MaxLength {
		runes := []rune(c.Body)
		cc := *c
		suffixLen := utf8.RuneCountInString(truncationSuffix)
		if r.Comment.MaxLength <= suffixLen {
			// Limit too small for suffix — hard-truncate without suffix
			cc.Body = string(runes[:r.Comment.MaxLength])
		} else {
			contentLimit := r.Comment.MaxLength - suffixLen
			cc.Body = string(runes[:contentLimit]) + truncationSuffix
		}
		d.Allowed = append(d.Allowed, "comment (truncated)")
		return &cc
	}
	d.Allowed = append(d.Allowed, "comment")
	return c
}

func (r *RuleFilter) applyLabels(l *LabelAction, d *Decision) *LabelAction {
	if l == nil {
		return nil
	}
	if r.Labels != nil && !r.Labels.Allow {
		d.Denied = append(d.Denied, "labels: blocked by policy")
		return nil
	}
	return filterLabels(l, r.Labels, d)
}

func (r *RuleFilter) applyStatus(s *StatusAction, d *Decision) *StatusAction {
	if s == nil {
		return nil
	}
	if r.Status != nil && !r.Status.Allow {
		d.Denied = append(d.Denied, "status: blocked by policy")
		return nil
	}
	// Validate status state against allowed values
	if s.State != "" && !ValidStatusStates[s.State] {
		d.Denied = append(d.Denied, fmt.Sprintf("status: invalid state %q", s.State))
		return nil
	}
	d.Allowed = append(d.Allowed, "status")
	return s
}

func (r *RuleFilter) applyCommit(c *CommitAction, d *Decision) *CommitAction {
	if c == nil {
		return nil
	}
	if r.Commit != nil && !r.Commit.Allow {
		d.Denied = append(d.Denied, "commit: blocked by policy")
		return nil
	}
	if r.Commit != nil && r.Commit.MaxSize > 0 && len(c.Diff) > r.Commit.MaxSize {
		d.Denied = append(d.Denied, fmt.Sprintf("commit: diff %d bytes exceeds max_size %d", len(c.Diff), r.Commit.MaxSize))
		return nil
	}
	d.Allowed = append(d.Allowed, "commit")
	return c
}

func (r *RuleFilter) applyMetadata(m map[string]any, d *Decision) map[string]any {
	if m == nil {
		return nil
	}
	if r.Metadata != nil && !r.Metadata.Allow {
		d.Denied = append(d.Denied, "metadata: redacted by policy")
		return nil
	}
	return m
}

func filterLabels(labels *LabelAction, policy *LabelPolicy, d *Decision) *LabelAction {
	if policy == nil {
		d.Allowed = append(d.Allowed, "labels")
		return labels
	}
	allowSet := buildCaseInsensitiveSet(policy.Allowed)
	blockSet := buildCaseInsensitiveSet(policy.Blocked)
	hasAllowlist := len(allowSet) > 0

	filteredAdd := filterLabelList(labels.Add, allowSet, blockSet, hasAllowlist, "add", d)
	filteredRemove := filterLabelList(labels.Remove, allowSet, blockSet, hasAllowlist, "remove", d)

	if len(filteredAdd) == 0 && len(filteredRemove) == 0 {
		return nil
	}
	d.Allowed = append(d.Allowed, "labels")
	return &LabelAction{Add: filteredAdd, Remove: filteredRemove}
}

func filterLabelList(labels []string, allow, block map[string]bool, hasAllowlist bool, action string, d *Decision) []string {
	var out []string
	for _, l := range labels {
		lower := strings.ToLower(l)
		if block[lower] {
			d.Denied = append(d.Denied, fmt.Sprintf("label %s %q: blocked by policy", action, l))
			continue
		}
		if hasAllowlist && !allow[lower] {
			d.Denied = append(d.Denied, fmt.Sprintf("label %s %q: not in allowlist", action, l))
			continue
		}
		out = append(out, l)
	}
	return out
}

func buildCaseInsensitiveSet(items []string) map[string]bool {
	if len(items) == 0 {
		return nil
	}
	set := make(map[string]bool, len(items))
	for _, s := range items {
		set[strings.ToLower(s)] = true
	}
	return set
}
