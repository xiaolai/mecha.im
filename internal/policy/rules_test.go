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
	res := Result{Comment: &CommentAction{Body: "this is a very long comment body"}}
	filtered, d, _ := f.Apply(context.Background(), &event.Event{}, res)
	if filtered.Comment == nil {
		t.Fatal("comment should exist")
	}
	if len(filtered.Comment.Body) > 50 { // 10 + truncation notice
		t.Errorf("comment not truncated: len=%d", len(filtered.Comment.Body))
	}
	if len(d.Allowed) != 1 || d.Allowed[0] != "comment (truncated)" {
		t.Errorf("allowed = %v", d.Allowed)
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
