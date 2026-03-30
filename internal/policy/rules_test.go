package policy

import (
	"context"
	"testing"

	"mecha.im/internal/event"
)

func TestAllowAll(t *testing.T) {
	f := &AllowAll{}
	res := Result{
		Output:  "hello",
		Comment: &CommentAction{Body: "review"},
		Labels:  &LabelAction{Add: []string{"ok"}},
		Status:  &StatusAction{State: "success"},
	}
	filtered, d, err := f.Apply(context.Background(), &event.Event{}, res)
	if err != nil {
		t.Fatal(err)
	}
	if filtered.Comment == nil || filtered.Labels == nil || filtered.Status == nil {
		t.Error("AllowAll should not filter anything")
	}
	if len(d.Allowed) != 3 {
		t.Errorf("allowed = %d, want 3", len(d.Allowed))
	}
	if len(d.Denied) != 0 {
		t.Errorf("denied = %v", d.Denied)
	}
}

func TestRuleFilterBlockComment(t *testing.T) {
	f := &RuleFilter{Comment: &CommentPolicy{Allow: false}}
	res := Result{Comment: &CommentAction{Body: "review"}}
	filtered, d, _ := f.Apply(context.Background(), &event.Event{}, res)
	if filtered.Comment != nil {
		t.Error("comment should be blocked")
	}
	if len(d.Denied) != 1 {
		t.Errorf("denied = %v", d.Denied)
	}
}

func TestRuleFilterTruncateComment(t *testing.T) {
	f := &RuleFilter{Comment: &CommentPolicy{Allow: true, MaxLength: 10}}
	original := "this is a very long comment body"
	res := Result{Comment: &CommentAction{Body: original}}
	filtered, d, _ := f.Apply(context.Background(), &event.Event{}, res)
	if filtered.Comment == nil {
		t.Fatal("comment should exist")
	}
	suffix := "\n\n... (truncated by policy)"
	runes := []rune(filtered.Comment.Body)
	// First 10 runes + suffix
	if len(runes) != 10+len([]rune(suffix)) {
		t.Errorf("truncated rune count = %d, want %d", len(runes), 10+len([]rune(suffix)))
	}
	if len(d.Allowed) != 1 || d.Allowed[0] != "comment (truncated)" {
		t.Errorf("allowed = %v", d.Allowed)
	}
	// Original must not be mutated
	if res.Comment.Body != original {
		t.Errorf("original mutated: got %q, want %q", res.Comment.Body, original)
	}
}

func TestRuleFilterTruncateUTF8(t *testing.T) {
	f := &RuleFilter{Comment: &CommentPolicy{Allow: true, MaxLength: 5}}
	res := Result{Comment: &CommentAction{Body: "\u4f60\u597d\u4e16\u754c\uff01\u6d4b\u8bd5"}} // 7 CJK chars
	filtered, _, _ := f.Apply(context.Background(), &event.Event{}, res)
	if filtered.Comment == nil {
		t.Fatal("comment should exist")
	}
	runes := []rune(filtered.Comment.Body)
	// First 5 CJK chars + suffix
	if string(runes[:5]) != "\u4f60\u597d\u4e16\u754c\uff01" {
		t.Errorf("first 5 runes = %q", string(runes[:5]))
	}
}

func TestRuleFilterBlockLabels(t *testing.T) {
	f := &RuleFilter{Labels: &LabelPolicy{Allow: false}}
	res := Result{Labels: &LabelAction{Add: []string{"ok"}}}
	filtered, d, _ := f.Apply(context.Background(), &event.Event{}, res)
	if filtered.Labels != nil {
		t.Error("labels should be blocked")
	}
	if len(d.Denied) != 1 {
		t.Errorf("denied = %v", d.Denied)
	}
}

func TestRuleFilterBlockedLabels(t *testing.T) {
	f := &RuleFilter{Labels: &LabelPolicy{Allow: true, Blocked: []string{"approved"}}}
	res := Result{Labels: &LabelAction{Add: []string{"ok", "approved", "reviewed"}}}
	filtered, _, _ := f.Apply(context.Background(), &event.Event{}, res)
	if filtered.Labels == nil {
		t.Fatal("labels should exist")
	}
	for _, l := range filtered.Labels.Add {
		if l == "approved" {
			t.Error("approved should be blocked")
		}
	}
	if len(filtered.Labels.Add) != 2 {
		t.Errorf("add = %v, want [ok reviewed]", filtered.Labels.Add)
	}
}

func TestRuleFilterBlockedLabelRemovals(t *testing.T) {
	f := &RuleFilter{Labels: &LabelPolicy{Allow: true, Blocked: []string{"approved", "do-not-merge"}}}
	res := Result{Labels: &LabelAction{
		Add:    []string{"needs-review"},
		Remove: []string{"approved", "stale", "do-not-merge"},
	}}
	filtered, d, _ := f.Apply(context.Background(), &event.Event{}, res)
	if filtered.Labels == nil {
		t.Fatal("labels should exist")
	}
	if len(filtered.Labels.Remove) != 1 || filtered.Labels.Remove[0] != "stale" {
		t.Errorf("remove = %v, want [stale]", filtered.Labels.Remove)
	}
	// Should have 2 denied entries for blocked removals
	deniedCount := 0
	for _, msg := range d.Denied {
		if msg != "" {
			deniedCount++
		}
	}
	if deniedCount != 2 {
		t.Errorf("denied = %v, want 2 entries", d.Denied)
	}
}

func TestRuleFilterBlockStatus(t *testing.T) {
	f := &RuleFilter{Status: &StatusPolicy{Allow: false}}
	res := Result{Status: &StatusAction{State: "success"}}
	filtered, _, _ := f.Apply(context.Background(), &event.Event{}, res)
	if filtered.Status != nil {
		t.Error("status should be blocked")
	}
}

func TestRuleFilterBlockCommit(t *testing.T) {
	f := &RuleFilter{Commit: &CommitPolicy{Allow: false}}
	res := Result{Commit: &CommitAction{Message: "fix"}}
	filtered, _, _ := f.Apply(context.Background(), &event.Event{}, res)
	if filtered.Commit != nil {
		t.Error("commit should be blocked")
	}
}

func TestRuleFilterAllowByDefault(t *testing.T) {
	f := &RuleFilter{} // no rules = allow all
	res := Result{
		Comment: &CommentAction{Body: "review"},
		Status:  &StatusAction{State: "success"},
	}
	filtered, _, _ := f.Apply(context.Background(), &event.Event{}, res)
	if filtered.Comment == nil || filtered.Status == nil {
		t.Error("nil rules should allow all")
	}
}

func TestParseRulesNil(t *testing.T) {
	f := ParseRules(nil)
	if _, ok := f.(*AllowAll); !ok {
		t.Error("nil map should return AllowAll")
	}
}

func TestParseRulesEmpty(t *testing.T) {
	f := ParseRules(map[string]any{})
	if _, ok := f.(*AllowAll); !ok {
		t.Error("empty map should return AllowAll")
	}
}

func TestParseRulesMalformedTypes(t *testing.T) {
	// Wrong type for comment (string instead of map) — should not panic
	raw := map[string]any{
		"comment": "yes",
		"labels":  42,
		"status":  true,
	}
	f := ParseRules(raw)
	rf, ok := f.(*RuleFilter)
	if !ok {
		t.Fatal("expected RuleFilter")
	}
	// All should be nil since type assertions failed
	if rf.Comment != nil {
		t.Error("comment should be nil for wrong type")
	}
	if rf.Labels != nil {
		t.Error("labels should be nil for wrong type")
	}
	if rf.Status != nil {
		t.Error("status should be nil for wrong type")
	}
}

func TestParseRulesUnknownKeys(t *testing.T) {
	raw := map[string]any{
		"unknown_key": map[string]any{"allow": true},
		"comment":     map[string]any{"allow": true},
	}
	f := ParseRules(raw)
	rf, ok := f.(*RuleFilter)
	if !ok {
		t.Fatal("expected RuleFilter")
	}
	if rf.Comment == nil || !rf.Comment.Allow {
		t.Error("valid comment key should be parsed")
	}
}

func TestRuleFilterEmptyResult(t *testing.T) {
	f := &RuleFilter{Comment: &CommentPolicy{Allow: false}}
	res := Result{} // empty result — no actions
	_, d, err := f.Apply(context.Background(), &event.Event{}, res)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Allowed) != 0 || len(d.Denied) != 0 {
		t.Errorf("empty result should produce empty decision, got allowed=%v denied=%v", d.Allowed, d.Denied)
	}
}

func TestParseRulesWithConfig(t *testing.T) {
	raw := map[string]any{
		"comment": map[string]any{"allow": true, "max_length": float64(5000)},
		"labels":  map[string]any{"allow": true, "blocked": []any{"approved"}},
		"status":  map[string]any{"allow": false},
		"commit":  map[string]any{"allow": false},
	}
	f := ParseRules(raw)
	rf, ok := f.(*RuleFilter)
	if !ok {
		t.Fatal("expected RuleFilter")
	}
	if rf.Comment == nil || !rf.Comment.Allow || rf.Comment.MaxLength != 5000 {
		t.Errorf("comment = %+v", rf.Comment)
	}
	if rf.Labels == nil || len(rf.Labels.Blocked) != 1 {
		t.Errorf("labels = %+v", rf.Labels)
	}
	if rf.Status == nil || rf.Status.Allow {
		t.Errorf("status = %+v", rf.Status)
	}
	if rf.Commit == nil || rf.Commit.Allow {
		t.Errorf("commit = %+v", rf.Commit)
	}
}
