package policies

import (
	"context"
	"strings"
	"testing"
	"unicode/utf8"

	"mecha.im/internal/events"
)

func apply(f Filter, res Result) (Result, Decision) {
	r, d, _ := f.Apply(context.Background(), &events.Event{}, res)
	return r, d
}

// --- Bug fix: truncation respects max_length ---

func TestTruncationRespectsMaxLength(t *testing.T) {
	tests := []struct {
		name      string
		maxLength int
		body      string
		wantMax   int
	}{
		{"short body not truncated", 100, "short", 5},
		{"exact length not truncated", 50, strings.Repeat("a", 50), 50},
		{"long body truncated", 50, strings.Repeat("a", 200), 50},
		{"very small max hard-truncates without suffix", 1, strings.Repeat("a", 100), 1},
		{"max equals suffix length hard-truncates", 27, strings.Repeat("a", 100), 27},
		{"CJK truncated", 30, "你好世界！测试测试测试", 30},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &RuleFilter{Comment: &CommentPolicy{Allow: true, MaxLength: tt.maxLength}}
			r, _ := apply(f, Result{Comment: &CommentAction{Body: tt.body}})
			if r.Comment == nil {
				t.Fatal("comment nil")
			}
			got := utf8.RuneCountInString(r.Comment.Body)
			if got > tt.wantMax {
				t.Errorf("body %d runes > max %d", got, tt.wantMax)
			}
		})
	}
}

// --- Bug fix: case-insensitive label matching ---

func TestLabelBlocklistCaseInsensitive(t *testing.T) {
	f := &RuleFilter{Labels: &LabelPolicy{Allow: true, Blocked: []string{"Approved", "DO-NOT-MERGE"}}}
	res := Result{Labels: &LabelAction{
		Add:    []string{"approved", "bug", "DO-NOT-MERGE", "do-not-merge"},
		Remove: []string{"APPROVED", "stale"},
	}}
	r, d := apply(f, res)
	if r.Labels == nil {
		t.Fatal("labels nil")
	}
	// Only "bug" should survive in add
	if len(r.Labels.Add) != 1 || r.Labels.Add[0] != "bug" {
		t.Errorf("add = %v, want [bug]", r.Labels.Add)
	}
	// Only "stale" should survive in remove
	if len(r.Labels.Remove) != 1 || r.Labels.Remove[0] != "stale" {
		t.Errorf("remove = %v, want [stale]", r.Labels.Remove)
	}
	// 4 labels blocked total
	blocked := 0
	for _, msg := range d.Denied {
		if strings.Contains(msg, "blocked") {
			blocked++
		}
	}
	if blocked != 4 {
		t.Errorf("blocked count = %d, want 4", blocked)
	}
}

// --- New: label allowlist ---

func TestLabelAllowlist(t *testing.T) {
	f := &RuleFilter{Labels: &LabelPolicy{Allow: true, Allowed: []string{"bug", "enhancement"}}}
	res := Result{Labels: &LabelAction{
		Add:    []string{"bug", "approved", "Enhancement"},
		Remove: []string{"stale"},
	}}
	r, d := apply(f, res)
	if r.Labels == nil {
		t.Fatal("labels nil")
	}
	// "bug" and "Enhancement" (case-insensitive match) allowed
	if len(r.Labels.Add) != 2 {
		t.Errorf("add = %v, want [bug Enhancement]", r.Labels.Add)
	}
	// "stale" not in allowlist
	if len(r.Labels.Remove) != 0 {
		t.Errorf("remove = %v, want []", r.Labels.Remove)
	}
	notAllowed := 0
	for _, msg := range d.Denied {
		if strings.Contains(msg, "not in allowlist") {
			notAllowed++
		}
	}
	if notAllowed != 2 { // "approved" add + "stale" remove
		t.Errorf("not-in-allowlist count = %d, want 2", notAllowed)
	}
}

func TestLabelAllowlistAndBlocklistCombined(t *testing.T) {
	// Blocklist takes precedence over allowlist
	f := &RuleFilter{Labels: &LabelPolicy{
		Allow:   true,
		Allowed: []string{"bug", "approved"},
		Blocked: []string{"approved"},
	}}
	res := Result{Labels: &LabelAction{Add: []string{"bug", "approved", "wontfix"}}}
	r, _ := apply(f, res)
	// "approved" blocked (blocklist wins), "wontfix" not in allowlist, only "bug" passes
	if len(r.Labels.Add) != 1 || r.Labels.Add[0] != "bug" {
		t.Errorf("add = %v, want [bug]", r.Labels.Add)
	}
}

// --- New: status state validation ---

func TestStatusStateValidation(t *testing.T) {
	tests := []struct {
		state string
		want  bool // true = allowed
	}{
		{"success", true},
		{"failure", true},
		{"pending", true},
		{"error", true},
		{"APPROVED", false},
		{"invalid", false},
		{"", true}, // empty state allowed (writeback handles it)
	}
	for _, tt := range tests {
		t.Run(tt.state, func(t *testing.T) {
			f := &RuleFilter{Status: &StatusPolicy{Allow: true}}
			r, d := apply(f, Result{Status: &StatusAction{State: tt.state}})
			if tt.want && r.Status == nil {
				t.Errorf("state %q should be allowed", tt.state)
			}
			if !tt.want && r.Status != nil {
				t.Errorf("state %q should be denied", tt.state)
			}
			if !tt.want && len(d.Denied) == 0 {
				t.Error("expected denied entry for invalid state")
			}
		})
	}
}

// --- New: commit diff size limit ---

func TestCommitDiffMaxSize(t *testing.T) {
	f := &RuleFilter{Commit: &CommitPolicy{Allow: true, MaxSize: 100}}

	// Under limit
	r, _ := apply(f, Result{Commit: &CommitAction{Diff: strings.Repeat("a", 50)}})
	if r.Commit == nil {
		t.Error("commit should be allowed (under max_size)")
	}

	// Over limit
	r, d := apply(f, Result{Commit: &CommitAction{Diff: strings.Repeat("a", 200)}})
	if r.Commit != nil {
		t.Error("commit should be denied (over max_size)")
	}
	if len(d.Denied) == 0 || !strings.Contains(d.Denied[0], "exceeds max_size") {
		t.Errorf("denied = %v", d.Denied)
	}
}

func TestCommitDiffNoLimit(t *testing.T) {
	f := &RuleFilter{Commit: &CommitPolicy{Allow: true}} // MaxSize=0 means no limit
	r, _ := apply(f, Result{Commit: &CommitAction{Diff: strings.Repeat("x", 10_000_000)}})
	if r.Commit == nil {
		t.Error("commit should be allowed (no max_size)")
	}
}

// --- New: metadata redaction ---

func TestMetadataRedaction(t *testing.T) {
	f := &RuleFilter{Metadata: &MetadataPolicy{Allow: false}}
	res := Result{
		Output:   "hello",
		Metadata: map[string]any{"model": "claude-sonnet", "tokens": 5000},
	}
	r, d := apply(f, res)
	if r.Metadata != nil {
		t.Error("metadata should be redacted")
	}
	if r.Output != "hello" {
		t.Error("output should be preserved")
	}
	if len(d.Denied) == 0 || !strings.Contains(d.Denied[0], "redacted") {
		t.Errorf("denied = %v", d.Denied)
	}
}

func TestMetadataAllowed(t *testing.T) {
	f := &RuleFilter{Metadata: &MetadataPolicy{Allow: true}}
	res := Result{Metadata: map[string]any{"model": "claude"}}
	r, _ := apply(f, res)
	if r.Metadata == nil {
		t.Error("metadata should be preserved when allowed")
	}
}

func TestMetadataNoPolicyAllowed(t *testing.T) {
	f := &RuleFilter{} // no metadata policy = allow by default
	res := Result{Metadata: map[string]any{"model": "claude"}}
	r, _ := apply(f, res)
	if r.Metadata == nil {
		t.Error("metadata should be preserved when no policy set")
	}
}

// --- New: ParseRules for new fields ---

func TestParseRulesLabelAllowlist(t *testing.T) {
	raw := map[string]any{
		"labels": map[string]any{
			"allow":   true,
			"allowed": []any{"bug", "enhancement"},
			"blocked": []any{"approved"},
		},
	}
	f, err := ParseRules(raw)
	if err != nil {
		t.Fatal(err)
	}
	rf := f.(*RuleFilter)
	if len(rf.Labels.Allowed) != 2 {
		t.Errorf("allowed = %v", rf.Labels.Allowed)
	}
	if len(rf.Labels.Blocked) != 1 {
		t.Errorf("blocked = %v", rf.Labels.Blocked)
	}
}

func TestParseRulesCommitMaxSize(t *testing.T) {
	raw := map[string]any{
		"commit": map[string]any{"allow": true, "max_size": float64(50000)},
	}
	f, _ := ParseRules(raw)
	rf := f.(*RuleFilter)
	if rf.Commit.MaxSize != 50000 {
		t.Errorf("max_size = %d, want 50000", rf.Commit.MaxSize)
	}
}

func TestParseRulesMetadata(t *testing.T) {
	raw := map[string]any{
		"metadata": map[string]any{"allow": false},
	}
	f, _ := ParseRules(raw)
	rf := f.(*RuleFilter)
	if rf.Metadata == nil || rf.Metadata.Allow {
		t.Error("metadata should be parsed as deny")
	}
}

func TestParseRulesMetadataBadType(t *testing.T) {
	raw := map[string]any{
		"metadata": map[string]any{"allow": "no"},
	}
	_, err := ParseRules(raw)
	if err == nil {
		t.Error("expected error for non-bool metadata.allow")
	}
}
