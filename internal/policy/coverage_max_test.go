package policy

import (
	"context"
	"testing"

	"mecha.im/internal/event"
)

// --- parseBoolField: non-bool value ---

func TestParseBoolFieldNonBool(t *testing.T) {
	m := map[string]any{"allow": "yes"}
	_, err := parseBoolField(m, "allow", "comment")
	if err == nil {
		t.Error("expected error for non-bool value")
	}
}

func TestParseBoolFieldInt(t *testing.T) {
	m := map[string]any{"allow": 1}
	_, err := parseBoolField(m, "allow", "status")
	if err == nil {
		t.Error("expected error for int value in bool field")
	}
}

func TestParseBoolFieldMissing(t *testing.T) {
	m := map[string]any{}
	val, err := parseBoolField(m, "allow", "comment")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val {
		t.Error("expected false for missing key")
	}
}

// --- ParseRules: invalid field types ---

func TestParseRulesInvalidCommentAllow(t *testing.T) {
	raw := map[string]any{
		"comment": map[string]any{
			"allow": "true", // string, not bool
		},
	}
	_, err := ParseRules(raw)
	if err == nil {
		t.Error("expected error for string allow in comment")
	}
}

func TestParseRulesInvalidLabelsAllow(t *testing.T) {
	raw := map[string]any{
		"labels": map[string]any{
			"allow": 1,
		},
	}
	_, err := ParseRules(raw)
	if err == nil {
		t.Error("expected error for int allow in labels")
	}
}

func TestParseRulesInvalidStatusAllow(t *testing.T) {
	raw := map[string]any{
		"status": map[string]any{
			"allow": "yes",
		},
	}
	_, err := ParseRules(raw)
	if err == nil {
		t.Error("expected error for string allow in status")
	}
}

func TestParseRulesInvalidCommitAllow(t *testing.T) {
	raw := map[string]any{
		"commit": map[string]any{
			"allow": 0,
		},
	}
	_, err := ParseRules(raw)
	if err == nil {
		t.Error("expected error for int allow in commit")
	}
}

// --- filterLabels: nil Blocked list ---

func TestFilterLabelsNilBlocked(t *testing.T) {
	labels := &LabelAction{
		Add:    []string{"bug", "security"},
		Remove: []string{"stale"},
	}
	policy := &LabelPolicy{Allow: true, Blocked: nil}
	d := &Decision{}
	result := filterLabels(labels, policy, d)

	if len(result.Add) != 2 || len(result.Remove) != 1 {
		t.Errorf("expected all labels through with nil Blocked, got add=%v remove=%v", result.Add, result.Remove)
	}
	if len(d.Allowed) != 1 || d.Allowed[0] != "labels" {
		t.Errorf("allowed = %v", d.Allowed)
	}
}

func TestFilterLabelsNilPolicy(t *testing.T) {
	labels := &LabelAction{
		Add: []string{"a"},
	}
	d := &Decision{}
	result := filterLabels(labels, nil, d)
	if len(result.Add) != 1 {
		t.Error("expected labels to pass through with nil policy")
	}
}

// --- AllowAll.Apply: nil fields in Result ---

func TestAllowAllApplyNilFields(t *testing.T) {
	a := &AllowAll{}
	res := Result{Output: "hello"}
	filtered, decision, err := a.Apply(context.Background(), &event.Event{}, res)
	if err != nil {
		t.Fatal(err)
	}
	if filtered.Output != "hello" {
		t.Errorf("output = %q", filtered.Output)
	}
	if len(decision.Allowed) != 0 {
		t.Errorf("expected 0 allowed for nil fields, got %d", len(decision.Allowed))
	}
}

func TestAllowAllApplyAllFields(t *testing.T) {
	a := &AllowAll{}
	res := Result{
		Output:  "out",
		Comment: &CommentAction{Body: "c"},
		Labels:  &LabelAction{Add: []string{"a"}},
		Status:  &StatusAction{State: "success"},
		Commit:  &CommitAction{Diff: "d"},
	}
	filtered, decision, err := a.Apply(context.Background(), &event.Event{}, res)
	if err != nil {
		t.Fatal(err)
	}
	if filtered.Comment == nil || filtered.Labels == nil || filtered.Status == nil || filtered.Commit == nil {
		t.Error("AllowAll should preserve all fields")
	}
	if len(decision.Allowed) != 4 {
		t.Errorf("allowed count = %d, want 4", len(decision.Allowed))
	}
}

// --- RuleFilter.Apply: status denied ---

func TestRuleFilterStatusDenied(t *testing.T) {
	r := &RuleFilter{
		Status: &StatusPolicy{Allow: false},
	}
	res := Result{
		Status: &StatusAction{State: "success"},
	}
	filtered, decision, err := r.Apply(context.Background(), &event.Event{}, res)
	if err != nil {
		t.Fatal(err)
	}
	if filtered.Status != nil {
		t.Error("status should be denied")
	}
	if len(decision.Denied) != 1 {
		t.Errorf("denied count = %d, want 1", len(decision.Denied))
	}
}

// --- RuleFilter.Apply: commit denied ---

func TestRuleFilterCommitDenied(t *testing.T) {
	r := &RuleFilter{
		Commit: &CommitPolicy{Allow: false},
	}
	res := Result{
		Commit: &CommitAction{Diff: "d", Message: "m"},
	}
	filtered, decision, err := r.Apply(context.Background(), &event.Event{}, res)
	if err != nil {
		t.Fatal(err)
	}
	if filtered.Commit != nil {
		t.Error("commit should be denied")
	}
	if len(decision.Denied) != 1 {
		t.Errorf("denied count = %d, want 1", len(decision.Denied))
	}
}

// --- ParseRules: max_length as float64 (from JSON) ---

func TestParseRulesMaxLengthFloat64(t *testing.T) {
	raw := map[string]any{
		"comment": map[string]any{
			"allow":      true,
			"max_length": float64(500),
		},
	}
	f, err := ParseRules(raw)
	if err != nil {
		t.Fatal(err)
	}
	rf := f.(*RuleFilter)
	if rf.Comment.MaxLength != 500 {
		t.Errorf("MaxLength = %d, want 500", rf.Comment.MaxLength)
	}
}

// --- ParseRules: max_length as int ---

func TestParseRulesMaxLengthInt(t *testing.T) {
	raw := map[string]any{
		"comment": map[string]any{
			"allow":      true,
			"max_length": 300,
		},
	}
	f, err := ParseRules(raw)
	if err != nil {
		t.Fatal(err)
	}
	rf := f.(*RuleFilter)
	if rf.Comment.MaxLength != 300 {
		t.Errorf("MaxLength = %d, want 300", rf.Comment.MaxLength)
	}
}

// --- ParseRules: labels with blocked list ---

func TestParseRulesLabelsBlocked(t *testing.T) {
	raw := map[string]any{
		"labels": map[string]any{
			"allow":   true,
			"blocked": []any{"critical", "production"},
		},
	}
	f, err := ParseRules(raw)
	if err != nil {
		t.Fatal(err)
	}
	rf := f.(*RuleFilter)
	if len(rf.Labels.Blocked) != 2 {
		t.Errorf("Blocked count = %d, want 2", len(rf.Labels.Blocked))
	}
}

// --- RuleFilter: labels with blocked list filtering ---

func TestRuleFilterLabelsBlocked(t *testing.T) {
	r := &RuleFilter{
		Labels: &LabelPolicy{Allow: true, Blocked: []string{"critical"}},
	}
	res := Result{
		Labels: &LabelAction{
			Add:    []string{"bug", "critical"},
			Remove: []string{"critical", "stale"},
		},
	}
	filtered, decision, err := r.Apply(context.Background(), &event.Event{}, res)
	if err != nil {
		t.Fatal(err)
	}
	if len(filtered.Labels.Add) != 1 || filtered.Labels.Add[0] != "bug" {
		t.Errorf("Add = %v, want [bug]", filtered.Labels.Add)
	}
	if len(filtered.Labels.Remove) != 1 || filtered.Labels.Remove[0] != "stale" {
		t.Errorf("Remove = %v, want [stale]", filtered.Labels.Remove)
	}
	// Should have 2 denied entries for the blocked label
	deniedCount := 0
	for _, d := range decision.Denied {
		if d != "" {
			deniedCount++
		}
	}
	if deniedCount != 2 {
		t.Errorf("denied count = %d, want 2", deniedCount)
	}
}
